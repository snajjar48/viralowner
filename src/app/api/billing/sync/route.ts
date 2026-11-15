import { syncSubscription } from "@/lib/billing";
import { getUserId } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";

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
    // Signed in: only your own subscription. Not yet (email to confirm first): only one just started.
    const userId = await getUserId();
    if (userId) {
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      const { data: profile } = await createAdminClient().from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
      if (!profile?.stripe_customer_id || profile.stripe_customer_id !== customerId) {
        return Response.json({ error: "Not found." }, { status: 404 });
      }
    } else if (subscription.created * 1000 < Date.now() - 30 * 60_000) {
      return Response.json({ error: "Please log in." }, { status: 401 });
    }
    const status = await syncSubscription(subscription);
    if (!status) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ status });
  } catch (error) {
    console.error("Subscription sync failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
