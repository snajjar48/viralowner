import type Stripe from "stripe";
import { APP_TAG, syncSubscription } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

/**
 * Stripe → viralowner updates (renewals, failed payments, plan changes,
 * cancellations). The Stripe account is shared, so anything not tagged
 * app=viralowner is acknowledged and ignored.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Stripe webhook received but STRIPE_WEBHOOK_SECRET is not set.");
    return Response.json({ error: "Not configured." }, { status: 500 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      request.headers.get("stripe-signature") ?? "",
      secret,
    );
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.metadata?.app === APP_TAG) {
      try {
        // Events can arrive out of order, so always read the latest state.
        await syncSubscription(await stripe.subscriptions.retrieve(sub.id));
      } catch (error) {
        console.error(`Webhook ${event.type} failed:`, error);
        return Response.json({ error: "Sync failed." }, { status: 500 }); // Stripe retries
      }
    }
  }

  return Response.json({ received: true });
}
