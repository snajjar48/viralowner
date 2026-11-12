import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { APP_TAG, isActiveStatus, syncSubscription } from "@/lib/billing";
import { clientIp } from "@/lib/client-ip";
import { isInterval, isTier } from "@/lib/plan-format";
import { priceIdFor } from "@/lib/plans";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseSignup } from "@/lib/signup-validation";
import { getStripe } from "@/lib/stripe";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Sign-up: create the account, the Stripe customer and the profile, then
 *  - free trial ({ choice: "trial" }): a SetupIntent that saves the card
 *    without charging it. Returns { kind: "setup", clientSecret, setupIntentId }.
 *    The trial is recorded by /api/billing/trial once the card is saved.
 *  - a plan ({ choice: "basic" | "pro", interval }): an incomplete subscription.
 *    Returns { kind: "payment", clientSecret, subscriptionId }; it activates
 *    once the browser pays the first invoice.
 * Card details go straight from the browser to Stripe, never to this server.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot: real people never fill the hidden "website" field.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return Response.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const input = parseSignup(body);
  if ("error" in input) {
    return Response.json({ error: input.error }, { status: 400 });
  }
  const trial = body.choice === "trial";
  if (!trial && !(isTier(body.choice) && isInterval(body.interval))) {
    return Response.json({ error: "Please choose the free trial or a plan." }, { status: 400 });
  }
  // Only viralowner's own prices can be bought here.
  const priceId = isTier(body.choice) && isInterval(body.interval) ? priceIdFor(body.choice, body.interval) : "";
  if (!trial && !priceId) {
    console.error("Signup failed: STRIPE_PRICE_* for", body.choice, body.interval, "not set.");
    return Response.json({ error: "Plans aren’t set up yet." }, { status: 500 });
  }

  try {
    if (!(await checkRateLimit(`signup:${clientIp(request)}`))) {
      return Response.json(
        { error: "Too many attempts. Please try again in a few minutes." },
        { status: 429 },
      );
    }
  } catch (error) {
    console.error("Signup rate limit failed:", error);
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: `${request.nextUrl.origin}/auth/confirm`,
        data: { first_name: input.firstName, last_name: input.lastName },
      },
    });

    if (error) {
      if (error.code === "user_already_exists" || error.code === "email_exists") {
        return Response.json(
          { error: "An account with this email already exists. Try logging in." },
          { status: 409 },
        );
      }
      if (error.code === "weak_password") {
        return Response.json(
          { error: "That password is too weak. Try a longer one." },
          { status: 400 },
        );
      }
      if (error.code === "over_email_send_rate_limit" || error.status === 429) {
        console.error("Supabase signUp rate limited:", error.code, error.message);
        return Response.json(
          { error: "Too many sign-up emails sent recently. Please wait a few minutes and try again." },
          { status: 429 },
        );
      }
      console.error("Supabase signUp failed:", error);
      return Response.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    // With email confirmation on, Supabase hides existing accounts by
    // returning a user with no identities instead of an error.
    const user = data.user;
    if (!user || user.identities?.length === 0) {
      return Response.json(
        { error: "An account with this email already exists. Try logging in." },
        { status: 409 },
      );
    }

    const { address } = input;
    const customerDetails = {
      email: input.email,
      name: `${input.firstName} ${input.lastName}`,
      phone: input.phone,
      address: {
        line1: address.line1,
        line2: address.line2 || "",
        city: address.city,
        state: address.state || "",
        postal_code: address.postalCode,
        country: address.country,
      },
      description: "viralowner",
      // Tag so viralowner customers are easy to filter in a shared Stripe account.
      metadata: { app: APP_TAG, supabase_user_id: user.id },
    };

    // Retrying sign-up (e.g. before confirming the email) returns the same
    // user, so reuse the Stripe customer from the earlier attempt if there is one.
    const stripe = getStripe();
    const existing = await stripe.customers.list({ email: input.email, limit: 10 });
    const previous = existing.data.find((c) => c.metadata?.supabase_user_id === user.id);
    const customer = previous
      ? await stripe.customers.update(previous.id, customerDetails)
      : await stripe.customers.create(customerDetails);

    const { error: profileError } = await createAdminClient()
      .from("profiles")
      .upsert({
        id: user.id,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone: input.phone,
        billing_address: address,
        stripe_customer_id: customer.id,
        terms_accepted_at: new Date().toISOString(),
      });
    if (profileError) {
      if (profileError.code === "PGRST205") {
        console.error("Signup failed: the profiles table is missing. Run supabase/schema.sql.");
        return Response.json(
          { error: "Accounts aren’t set up yet (database table missing)." },
          { status: 500 },
        );
      }
      throw profileError;
    }

    // One membership per account. Clear out abandoned attempts so a retry
    // (or a switch between monthly and yearly) starts fresh.
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 20,
    });
    if (subscriptions.data.some((sub) => isActiveStatus(sub.status))) {
      return Response.json(
        { error: "You already have a membership. Try logging in." },
        { status: 409 },
      );
    }
    for (const sub of subscriptions.data) {
      if (sub.status === "incomplete") await stripe.subscriptions.cancel(sub.id);
    }

    const needsEmailConfirmation = !data.session;
    if (trial) {
      // Saves the card for later; nothing is charged.
      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        allowed_payment_method_types: ["card"],
        usage: "off_session",
        description: "viralowner free trial: card saved, not charged",
        metadata: { app: APP_TAG, purpose: "trial", supabase_user_id: user.id },
      });
      if (!setupIntent.client_secret) throw new Error(`No client secret for ${setupIntent.id}`);
      return Response.json({
        kind: "setup",
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        needsEmailConfirmation,
      });
    }

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      description: "viralowner membership",
      payment_behavior: "default_incomplete",
      payment_settings: {
        payment_method_types: ["card"],
        save_default_payment_method: "on_subscription",
      },
      metadata: { app: APP_TAG, supabase_user_id: user.id, terms_accepted_at: new Date().toISOString() },
      expand: ["latest_invoice.confirmation_secret"],
    });
    await syncSubscription(subscription);

    const invoice = subscription.latest_invoice as Stripe.Invoice | null;
    const clientSecret = invoice?.confirmation_secret?.client_secret;
    if (!clientSecret) throw new Error(`No payment secret for ${subscription.id}`);

    return Response.json({
      kind: "payment",
      clientSecret,
      subscriptionId: subscription.id,
      needsEmailConfirmation,
    });
  } catch (error) {
    console.error("Signup failed:", error);
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
