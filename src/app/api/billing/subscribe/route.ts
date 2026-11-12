import type Stripe from "stripe";
import { APP_TAG, isActiveStatus, syncSubscription } from "@/lib/billing";
import { isInterval, isTier } from "@/lib/plan-format";
import { priceIdFor } from "@/lib/plans";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts a membership, only when the signed-in user picks a plan, ticks the
 * terms and presses subscribe on /plans. Nothing ever subscribes on its own.
 *   { tier, interval, acceptTerms: true, newCard: false }  charge the saved card
 *       → { status: "active" } or { status: "incomplete", clientSecret, subscriptionId }
 *         (the browser finishes 3-D Secure, or reports a decline)
 *   { ..., newCard: true }  → { status: "incomplete", clientSecret, subscriptionId }
 *       (the browser pays with the card typed into Stripe's card field)
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isTier(body.tier) || !isInterval(body.interval)) {
    return Response.json({ error: "Please choose a plan." }, { status: 400 });
  }
  if (body.acceptTerms !== true) {
    return Response.json({ error: "Please accept the terms to subscribe." }, { status: 400 });
  }
  const priceId = priceIdFor(body.tier, body.interval);
  if (!priceId) return Response.json({ error: "Plans aren’t set up yet." }, { status: 500 });

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Please log in again." }, { status: 401 });
    if (!(await checkRateLimit(`subscribe:${user.id}`, 10))) {
      return Response.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();
    const customerId = profile?.stripe_customer_id as string | undefined;
    if (!customerId) return Response.json({ error: "No billing account found." }, { status: 404 });

    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    if (subs.data.some((s) => s.metadata?.app === APP_TAG && isActiveStatus(s.status))) {
      return Response.json(
        { error: "You already have a membership. You can switch plans from your dashboard." },
        { status: 409 },
      );
    }
    // Clear out unfinished attempts so only one membership can ever start.
    for (const s of subs.data) {
      if (s.metadata?.app === APP_TAG && s.status === "incomplete") await stripe.subscriptions.cancel(s.id);
    }

    let savedCard: string | null = null;
    if (body.newCard !== true) {
      savedCard = await defaultCard(customerId);
      if (!savedCard) {
        return Response.json({ error: "Please enter a card.", needsCard: true }, { status: 400 });
      }
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      description: "viralowner membership",
      ...(savedCard
        ? { default_payment_method: savedCard, payment_behavior: "allow_incomplete" as const }
        : { payment_behavior: "default_incomplete" as const }),
      payment_settings: { payment_method_types: ["card"], save_default_payment_method: "on_subscription" },
      metadata: { app: APP_TAG, supabase_user_id: user.id, terms_accepted_at: new Date().toISOString() },
      expand: ["latest_invoice.confirmation_secret"],
    });
    await syncSubscription(subscription);

    if (subscription.status === "active") return Response.json({ status: "active", subscriptionId: subscription.id });
    const invoice = subscription.latest_invoice as Stripe.Invoice | null;
    const clientSecret = invoice?.confirmation_secret?.client_secret;
    if (!clientSecret) throw new Error(`No payment secret for ${subscription.id}`);
    return Response.json({ status: "incomplete", clientSecret, subscriptionId: subscription.id });
  } catch (error) {
    console.error("Subscribe failed:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

/** The card saved at sign-up (or since), if any. */
async function defaultCard(customerId: string) {
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(customerId);
  if (!customer.deleted) {
    const pm = customer.invoice_settings?.default_payment_method;
    if (pm) return typeof pm === "string" ? pm : pm.id;
  }
  const cards = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
  return cards.data[0]?.id ?? null;
}
