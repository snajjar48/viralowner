// Plan shapes and display helpers, safe to use in the browser.

export type PlanId = "monthly" | "yearly";

export type Plan = {
  id: PlanId;
  priceId: string;
  productId: string;
  /** Smallest currency unit (e.g. cents). */
  amount: number;
  currency: string;
};

export function isPlanId(value: unknown): value is PlanId {
  return value === "monthly" || value === "yearly";
}

export function formatMoney(amount: number, currency: string) {
  const value = amount / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

/** Whole-percent saving of yearly vs. 12 × monthly (0 if none). */
export function yearlySavingsPercent(monthly: Plan, yearly: Plan) {
  const full = monthly.amount * 12;
  if (full <= 0 || yearly.amount >= full) return 0;
  return Math.round(((full - yearly.amount) / full) * 100);
}
