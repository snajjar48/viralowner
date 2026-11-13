"use client";

import {
  CHANGES_PER_VIDEO,
  findPlan,
  formatMoney,
  TIER_NAMES,
  TIERS,
  TRIAL_CHANGES,
  VIDEO_LIMITS,
  yearlySavingsPercent,
  type Interval,
  type Plan,
  type Tier,
} from "@/lib/plan-format";

export type Choice = "trial" | Tier;

const TIER_VIDEOS: Record<Tier, string> = {
  basic: `${VIDEO_LIMITS.basic} videos a month`,
  pro: `up to ${VIDEO_LIMITS.pro} videos a month`,
};

/**
 * The free trial (optional) and the Basic / Pro plans, with a monthly/yearly
 * switch. Shows exact prices so the choice is never a surprise.
 */
export function PlanPicker({
  plans,
  choice,
  interval,
  onChoice,
  onInterval,
  includeTrial,
  disabled,
}: {
  plans: Plan[];
  choice: Choice;
  interval: Interval;
  onChoice: (c: Choice) => void;
  onInterval: (i: Interval) => void;
  includeTrial: boolean;
  disabled?: boolean;
}) {
  const savings = Math.max(
    ...TIERS.map((t) => {
      const m = findPlan(plans, t, "monthly");
      const y = findPlan(plans, t, "yearly");
      return m && y ? yearlySavingsPercent(m, y) : 0;
    }),
  );

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <div role="radiogroup" aria-label="Billing" className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 text-sm">
        {(["monthly", "yearly"] as const).map((i) => (
          <label
            key={i}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-full px-3 py-2 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-coral ${
              interval === i ? "bg-white/10 font-medium text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            <input
              type="radio"
              name="interval"
              value={i}
              checked={interval === i}
              onChange={() => onInterval(i)}
              className="sr-only"
            />
            {i === "monthly" ? "Monthly" : "Yearly"}
            {i === "yearly" && savings > 0 && (
              <span className="rounded-full bg-linear-to-r from-violet to-coral px-2 py-0.5 text-[11px] font-semibold text-white">
                save {savings}%
              </span>
            )}
          </label>
        ))}
      </div>

      <div role="radiogroup" aria-label="Plan" className="flex flex-col gap-3">
        {includeTrial && (
          <Option active={choice === "trial"} onSelect={() => onChoice("trial")} value="trial">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-medium">Free trial</span>
              <span className="text-xl font-semibold tracking-tight">$0</span>
            </span>
            <span className="text-sm text-muted text-pretty">
              1 free video with {TRIAL_CHANGES} change and a free download. card required, but it’s never charged
              unless you choose a plan later.
            </span>
          </Option>
        )}
        {TIERS.map((tier) => {
          const plan = findPlan(plans, tier, interval);
          if (!plan) return null;
          const monthly = interval === "yearly" ? formatMoney(Math.round(plan.amount / 12), plan.currency) : null;
          return (
            <Option key={tier} active={choice === tier} onSelect={() => onChoice(tier)} value={tier}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{TIER_NAMES[tier]}</span>
                <span className="text-xl font-semibold tracking-tight">
                  {formatMoney(plan.amount, plan.currency)}
                  <span className="text-sm font-normal text-muted">/{interval === "monthly" ? "month" : "year"}</span>
                </span>
              </span>
              <span className="text-sm text-muted">
                {TIER_VIDEOS[tier]}, {CHANGES_PER_VIDEO} changes per video
                {monthly && ` · about ${monthly}/month, billed yearly`}
              </span>
              {tier === "pro" && (
                <span className="flex items-start gap-1.5 text-sm text-pretty">
                  <span aria-hidden="true" className="text-coral">
                    ✦
                  </span>
                  <span>
                    <span className="font-medium">start from scratch:</span>{" "}
                    <span className="text-muted">upload your clips, describe the video you want, and we edit it for you. no inspo needed.</span>
                  </span>
                </span>
              )}
            </Option>
          );
        })}
      </div>
    </fieldset>
  );
}

function Option({
  active,
  onSelect,
  value,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 transition has-[:disabled]:cursor-default has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-coral ${
        active ? "border-transparent bg-white/[0.06] ring-2 ring-violet" : "border-white/15 bg-white/[0.03] hover:border-white/30"
      }`}
    >
      <input type="radio" name="plan" value={value} checked={active} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}
