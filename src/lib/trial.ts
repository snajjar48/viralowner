import "server-only";
import type Stripe from "stripe";
import { APP_TAG } from "./billing";
import { claimTrial } from "./membership";
import { getStripe } from "./stripe";
import { createAdminClient } from "./supabase/server";

/**
 * The free trial saves a card with a SetupIntent (no charge). Once Stripe says
 * it succeeded, this records the trial (one per account and per card), and
 * makes the card the customer's default so choosing a plan later can use it.
 * The card is never charged unless they choose a plan and press subscribe.
 * Called from the browser right after saving the card, and from the webhook.
 */
export async function trialFromSetupIntent(si: Stripe.SetupIntent): Promise<"claimed" | "card_used" | null> {
  if (si.metadata?.app !== APP_TAG || si.metadata?.purpose !== "trial" || si.status !== "succeeded") return null;
  const userId = si.metadata.supabase_user_id;
  const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
  const paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  if (!userId || !customerId || !paymentMethodId) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.stripe_customer_id !== customerId) return null;

  const stripe = getStripe();
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const fingerprint = pm.card?.fingerprint;
  if (!fingerprint) return null;

  const result = await claimTrial(userId, fingerprint);
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  await admin.from("profiles").update({ has_payment_method: true }).eq("id", userId);
  return result;
}
