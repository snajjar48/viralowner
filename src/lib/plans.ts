import "server-only";
import { cacheLife } from "next/cache";
import type { Plan, PlanId } from "./plan-format";
import { getStripe } from "./stripe";

// Price ids come from env so test-mode and live-mode prices can differ.
export function priceIdFor(plan: PlanId) {
  return (plan === "monthly" ? process.env.STRIPE_PRICE_MONTHLY : process.env.STRIPE_PRICE_YEARLY) ?? "";
}

export function planForPrice(priceId: string | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  return null;
}

/**
 * The two viralowner plans with amounts read from Stripe, so changing a price
 * in Stripe updates the site. Null if Stripe or the price ids aren't set up.
 */
export async function getPlans(): Promise<Plan[] | null> {
  "use cache";
  const ids: [PlanId, string][] = [
    ["monthly", priceIdFor("monthly")],
    ["yearly", priceIdFor("yearly")],
  ];
  try {
    if (!process.env.STRIPE_SECRET_KEY || ids.some(([, id]) => !id)) {
      throw new Error("STRIPE_SECRET_KEY / STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY not set");
    }
    const stripe = getStripe();
    const plans = await Promise.all(
      ids.map(async ([id, priceId]): Promise<Plan> => {
        const price = await stripe.prices.retrieve(priceId);
        if (!price.active || price.unit_amount == null || !price.recurring) {
          throw new Error(`Price ${priceId} must be an active recurring price`);
        }
        const productId = typeof price.product === "string" ? price.product : price.product.id;
        return { id, priceId, productId, amount: price.unit_amount, currency: price.currency };
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
