import { syncSubscription } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

/**
 * Called right after the browser pays, so the profile updates immediately
 * (the webhook does the same thing later). Reads the subscription from Stripe
 * itself, so it can only ever copy Stripe's real state.
 */
export async function POST(request: Request) {
  let subscriptionId: unknown;
  try {
    ({ subscriptionId } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof subscriptionId !== "string" || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const status = await syncSubscription(subscription);
    if (!status) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ status });
  } catch (error) {
    console.error("Subscription sync failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
