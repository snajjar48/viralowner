import "server-only";
import type Stripe from "stripe";
import { getPlans, planForPrice } from "./plans";
import { getStripe } from "./stripe";
import { createAdminClient } from "./supabase/server";

/** Marks Stripe objects that belong to viralowner (the Stripe account is shared). */
export const APP_TAG = "viralowner";

export const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function isActiveStatus(status: string | null | undefined) {
  return Boolean(status && ACTIVE_STATUSES.has(status));
}

/**
 * Copies a subscription's state from Stripe onto the user's profile.
 * Ignores subscriptions that aren't viralowner's, and stale ones (e.g. an
 * abandoned attempt) that would overwrite a newer subscription.
 */
export async function syncSubscription(sub: Stripe.Subscription) {
  if (sub.metadata?.app !== APP_TAG) return null;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("subscription_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!profile) return null;
  if (profile.subscription_id && profile.subscription_id !== sub.id && !isActiveStatus(sub.status)) {
    return null;
  }

  const item = sub.items.data[0];
  const { error } = await admin
    .from("profiles")
    .update({
      subscription_id: sub.id,
      subscription_status: sub.status,
      plan: planForPrice(item?.price.id),
      current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end,
      has_payment_method: sub.default_payment_method != null,
    })
    .eq("stripe_customer_id", customerId);
  if (error) throw error;
  return sub.status;
}

let portalConfigId: string | undefined;
const PORTAL_VERSION = "2"; // bump to roll out portal setting changes

/**
 * A billing-portal configuration that only offers viralowner's plans (Basic and Pro, monthly and yearly), so
 * customers never see other products in the shared Stripe account. Created
 * once and reused; the account's default portal is never touched.
 */
export async function getPortalConfigurationId(origin: string) {
  if (portalConfigId) return portalConfigId;
  const stripe = getStripe();

  for await (const config of stripe.billingPortal.configurations.list({ active: true, limit: 100 })) {
    if (config.metadata?.app === APP_TAG && config.metadata?.version === PORTAL_VERSION) {
      portalConfigId = config.id;
      return config.id;
    }
  }

  const plans = await getPlans();
  if (!plans) throw new Error("Plans are not configured");
  const byProduct = new Map<string, string[]>();
  for (const plan of plans) {
    byProduct.set(plan.productId, [...(byProduct.get(plan.productId) ?? []), plan.priceId]);
  }

  const config = await stripe.billingPortal.configurations.create({
    name: "viralowner",
    metadata: { app: APP_TAG, version: PORTAL_VERSION },
    business_profile: {
      headline: "viralowner: manage your membership",
      terms_of_service_url: `${origin}/terms`,
    },
    default_return_url: `${origin}/dashboard`,
    features: {
      customer_update: { enabled: true, allowed_updates: ["name", "address", "phone"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: [...byProduct].map(([product, prices]) => ({ product, prices })),
      },
    },
  });
  portalConfigId = config.id;
  return config.id;
}
