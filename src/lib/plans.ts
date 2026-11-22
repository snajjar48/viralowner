import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type Stripe from "stripe";
import { INTERVALS, PLAN_PRICES, planId, TIER_NAMES, TIERS, type Interval, type Plan, type PlanId, type Tier } from "./plan-format";
import { getStripe } from "./stripe";

/**
 * Each plan's price is found in Stripe by its lookup key (made by the admin's "create the plan prices"
 * button, lib/plans.ts createPlanPrices). Older setups named prices in env vars instead: used when a
 * lookup key isn't there yet.
 */
const LOOKUP_VERSION = "v2";
export const lookupKey = (tier: Tier, interval: Interval) => `viralowner_${tier}_${interval}_${LOOKUP_VERSION}`;

const PRICE_ENV: Partial<Record<PlanId, string>> = {
  "basic-monthly": "STRIPE_PRICE_BASIC_MONTHLY",
  "basic-yearly": "STRIPE_PRICE_BASIC_YEARLY",
  "pro-monthly": "STRIPE_PRICE_PRO_MONTHLY",
  "pro-yearly": "STRIPE_PRICE_PRO_YEARLY",
};

/** The cache tag on the plans (the admin route clears it after making new prices). */
export const PLANS_TAG = "plans";

const wanted = () => TIERS.flatMap((tier) => INTERVALS.map((interval) => ({ tier, interval })));

/**
 * The viralowner plans with amounts read from Stripe, so changing a price in Stripe updates the site.
 * Null if Stripe isn't set up or any plan's price is missing.
 */
export async function getPlans(): Promise<Plan[] | null> {
  "use cache";
  cacheTag(PLANS_TAG);
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
    const stripe = getStripe();
    const found = new Map<string, Stripe.Price>();
    const keys = wanted().map(({ tier, interval }) => lookupKey(tier, interval));
    for (const p of (await stripe.prices.list({ lookup_keys: keys, active: true, limit: 100 })).data) {
      if (p.lookup_key) found.set(p.lookup_key, p);
    }
    const plans = await Promise.all(
      wanted().map(async ({ tier, interval }): Promise<Plan> => {
        let price = found.get(lookupKey(tier, interval));
        const env = PRICE_ENV[planId(tier, interval)];
        if (!price && env && process.env[env]) price = await stripe.prices.retrieve(process.env[env]!);
        if (!price) throw new Error(`No Stripe price for ${planId(tier, interval)} (lookup key ${lookupKey(tier, interval)})`);
        const expected = interval === "monthly" ? "month" : "year";
        if (!price.active || price.unit_amount == null || price.recurring?.interval !== expected) {
          throw new Error(`Price ${price.id} must be an active price billed every ${expected}`);
        }
        const productId = typeof price.product === "string" ? price.product : price.product.id;
        return { id: planId(tier, interval), tier, interval, priceId: price.id, productId, amount: price.unit_amount, currency: price.currency };
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

/** The Stripe price to subscribe to for this plan ("" if plans aren't set up). */
export async function priceIdFor(tier: Tier, interval: Interval) {
  return (await getPlans())?.find((p) => p.tier === tier && p.interval === interval)?.priceId ?? "";
}

/** Which viralowner plan a Stripe price is, or null if it isn't one (older env-named prices count too). */
export async function planForPrice(priceId: string | undefined): Promise<PlanId | null> {
  if (!priceId) return null;
  const plan = (await getPlans())?.find((p) => p.priceId === priceId);
  if (plan) return plan.id;
  for (const [id, env] of Object.entries(PRICE_ENV) as [PlanId, string][]) {
    if (process.env[env] === priceId) return id;
  }
  return null;
}

/**
 * Makes the plans' prices in Stripe (PLAN_PRICES), each with its lookup key, on viralowner products
 * ("viralowner Basic", "viralowner Plus", "viralowner Pro", tagged app=viralowner so they're never
 * mixed up with the shared account's other business). Safe to run twice: a price whose lookup key
 * already exists at the right amount is left alone; one at another amount gets a new price (the key
 * moves to it) and the old one is archived. Returns what it did, for the admin page.
 */
export async function createPlanPrices(appTag: string): Promise<string[]> {
  const stripe = getStripe();
  const done: string[] = [];
  const existing = new Map<string, Stripe.Price>();
  const keys = wanted().map(({ tier, interval }) => lookupKey(tier, interval));
  for (const p of (await stripe.prices.list({ lookup_keys: keys, limit: 100 })).data) {
    if (p.lookup_key) existing.set(p.lookup_key, p);
  }
  // The products: reuse viralowner's own (by metadata), else make them.
  const products = new Map<Tier, string>();
  for await (const prod of stripe.products.list({ active: true, limit: 100 })) {
    const tier = prod.metadata?.tier as Tier | undefined;
    if (prod.metadata?.app === appTag && tier && TIERS.includes(tier) && !products.has(tier)) products.set(tier, prod.id);
  }
  for (const tier of TIERS) {
    if (products.has(tier)) continue;
    const prod = await stripe.products.create({
      name: `viralowner ${TIER_NAMES[tier]}`,
      metadata: { app: appTag, tier },
    });
    products.set(tier, prod.id);
    done.push(`made the product “viralowner ${TIER_NAMES[tier]}”`);
  }
  for (const { tier, interval } of wanted()) {
    const key = lookupKey(tier, interval);
    const amount = PLAN_PRICES[tier][interval];
    const have = existing.get(key);
    const label = `${TIER_NAMES[tier]} ${interval} $${amount / 100}`;
    if (have?.active && have.unit_amount === amount && have.recurring?.interval === (interval === "monthly" ? "month" : "year")) {
      done.push(`${label}: already set up`);
      continue;
    }
    await stripe.prices.create({
      product: products.get(tier)!,
      currency: "usd",
      unit_amount: amount,
      recurring: { interval: interval === "monthly" ? "month" : "year" },
      lookup_key: key,
      transfer_lookup_key: true,
      nickname: `viralowner ${TIER_NAMES[tier]} ${interval}`,
      metadata: { app: appTag, tier, interval },
    });
    if (have?.active) await stripe.prices.update(have.id, { active: false });
    done.push(`${label}: made${have ? " (the old one archived)" : ""}`);
  }
  return done;
}
