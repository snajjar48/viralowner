// Plan shapes, limits and display helpers, safe to use in the browser.

export type Tier = "basic" | "pro";
export type Interval = "monthly" | "yearly";
/** e.g. "basic-monthly". Stored on profiles.plan. */
export type PlanId = `${Tier}-${Interval}`;

export const TIERS: Tier[] = ["basic", "pro"];
export const INTERVALS: Interval[] = ["monthly", "yearly"];

export const TIER_NAMES: Record<Tier, string> = { basic: "Basic", pro: "Pro" };

/** Videos per month (yearly plans get the same, reset monthly). */
export const VIDEO_LIMITS: Record<Tier, number> = { basic: 10, pro: 30 };

/** Change requests / re-renders included with each video. */
export const CHANGES_PER_VIDEO = 3;
/** The free trial: one video with one change. */
export const TRIAL_CHANGES = 1;

export type Plan = {
  id: PlanId;
  tier: Tier;
  interval: Interval;
  priceId: string;
  productId: string;
  /** Smallest currency unit (e.g. cents). */
  amount: number;
  currency: string;
};

export function isTier(value: unknown): value is Tier {
  return value === "basic" || value === "pro";
}

export function isInterval(value: unknown): value is Interval {
  return value === "monthly" || value === "yearly";
}

export function planId(tier: Tier, interval: Interval): PlanId {
  return `${tier}-${interval}`;
}

export function parsePlanId(value: unknown): { tier: Tier; interval: Interval } | null {
  if (typeof value !== "string") return null;
  const [tier, interval] = value.split("-");
  return isTier(tier) && isInterval(interval) ? { tier, interval } : null;
}

export function formatMoney(amount: number, currency: string) {
  const value = amount / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

/** "$29.99/month" or "$299/year". */
export function formatPrice(plan: Plan) {
  return `${formatMoney(plan.amount, plan.currency)}/${plan.interval === "monthly" ? "month" : "year"}`;
}

/** Whole-percent saving of yearly vs. 12 × monthly (0 if none). */
export function yearlySavingsPercent(monthly: Plan, yearly: Plan) {
  const full = monthly.amount * 12;
  if (full <= 0 || yearly.amount >= full) return 0;
  return Math.round(((full - yearly.amount) / full) * 100);
}

export function findPlan(plans: Plan[], tier: Tier, interval: Interval) {
  return plans.find((p) => p.tier === tier && p.interval === interval);
}

/** The exact words shown next to the subscribe button, so nobody is surprised. */
export function chargeSummary(plan: Plan) {
  const price = formatMoney(plan.amount, plan.currency);
  const every = plan.interval === "monthly" ? "month" : "year";
  return `you’ll be charged ${price} today, then ${price} every ${every} until you cancel. cancel anytime from your dashboard.`;
}
