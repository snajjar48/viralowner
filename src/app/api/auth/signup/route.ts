import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseSignup } from "@/lib/signup-validation";
import { getStripe } from "@/lib/stripe";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Step 1 of sign-up: create the account, the Stripe customer and the profile,
 * then return a SetupIntent secret so the browser can save the card directly
 * with Stripe (card details never pass through this server).
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
      metadata: { supabase_user_id: user.id },
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

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      allowed_payment_method_types: ["card"],
      usage: "off_session",
      metadata: { supabase_user_id: user.id },
    });

    return Response.json({
      clientSecret: setupIntent.client_secret,
      needsEmailConfirmation: !data.session,
    });
  } catch (error) {
    console.error("Signup failed:", error);
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
