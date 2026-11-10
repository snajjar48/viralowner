import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Step 2 of sign-up: after the browser saves the card with Stripe, make it the
 * customer's default and mark the profile. Only acts on SetupIntents that
 * Stripe reports as succeeded, so it's safe to call more than once.
 */
export async function POST(request: Request) {
  let setupIntentId: unknown;
  try {
    ({ setupIntentId } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof setupIntentId !== "string" || !/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const intent = await stripe.setupIntents.retrieve(setupIntentId);
    const customerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
    const paymentMethodId =
      typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;

    if (intent.status !== "succeeded" || !customerId || !paymentMethodId) {
      return Response.json({ error: "Card not saved yet." }, { status: 400 });
    }

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const { error } = await createAdminClient()
      .from("profiles")
      .update({ has_payment_method: true })
      .eq("stripe_customer_id", customerId);
    if (error) throw error;

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Saving payment method failed:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
