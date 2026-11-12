import "server-only";
import { cacheLife } from "next/cache";
import { INTERVALS, planId, TIERS, type Interval, type Plan, type PlanId, type Tier } from "./plan-format";
import { getStripe } from "./stripe";

const PRICE_ENV: Record<PlanId, string> = {
  "basic-monthly": "STRIPE_PRICE_BASIC_MONTHLY",
  "basic-yearly": "STRIPE_PRICE_BASIC_YEARLY",
  "pro-monthly": "STRIPE_PRICE_PRO_MONTHLY",
  "pro-yearly": "STRIPE_PRICE_PRO_YEARLY",
};

// Price ids come from env so test-mode and live-mode prices can differ.
export function priceIdFor(tier: Tier, interval: Interval) {
  return process.env[PRICE_ENV[planId(tier, interval)]] ?? "";
}

/** Which viralowner plan a Stripe price is, or null if it isn't one. */
export function planForPrice(priceId: string | undefined): PlanId | null {
  if (!priceId) return null;
  for (const [id, env] of Object.entries(PRICE_ENV) as [PlanId, string][]) {
    if (process.env[env] === priceId) return id;
  }
  return null;
}

/**
 * The four viralowner plans with amounts read from Stripe, so changing a
 * price in Stripe updates the site. Null if Stripe or the price ids aren't set up.
 */
export async function getPlans(): Promise<Plan[] | null> {
  "use cache";
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
    const wanted = TIERS.flatMap((tier) => INTERVALS.map((interval) => ({ tier, interval })));
    const missing = wanted.filter(({ tier, interval }) => !priceIdFor(tier, interval));
    if (missing.length) {
      throw new Error(`Price ids not set: ${missing.map((m) => PRICE_ENV[planId(m.tier, m.interval)]).join(", ")}`);
    }
    const stripe = getStripe();
    const plans = await Promise.all(
      wanted.map(async ({ tier, interval }): Promise<Plan> => {
        const priceId = priceIdFor(tier, interval);
        const price = await stripe.prices.retrieve(priceId);
        const expected = interval === "monthly" ? "month" : "year";
        if (!price.active || price.unit_amount == null || price.recurring?.interval !== expected) {
          throw new Error(`Price ${priceId} must be an active price billed every ${expected}`);
        }
        const productId = typeof price.product === "string" ? price.product : price.product.id;
        return { id: planId(tier, interval), tier, interval, priceId, productId, amount: price.unit_amount, currency: price.currency };
      }),
    );
    cacheLife("hours");
    return plans;
  } catch (error) {
    console.error("Loading plans failed:", error);
    cacheLife("minutes"); // retry soon
    return null;
  }
}
