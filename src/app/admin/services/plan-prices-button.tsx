"use client";

import { useState } from "react";
import { PLAN_PRICES, TIER_NAMES, TIERS, VIDEO_LIMITS, tierHasScratch } from "@/lib/plan-format";

/** The owner's one click to make (or check) the plans' prices in Stripe. */
export function PlanPricesButton() {
  const [state, setState] = useState<{ busy: boolean; done?: string[]; error?: string }>({ busy: false });
  async function run() {
    if (!confirm("make these prices in Stripe (live)? nobody is charged; they become the prices people can subscribe to.")) return;
    setState({ busy: true });
    const res = await fetch("/api/admin/stripe-plans", { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setState(res?.ok ? { busy: false, done: data.done } : { busy: false, error: data?.error ?? "that didn’t work." });
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul className="flex flex-col gap-0.5 text-muted">
        {TIERS.map((t) => (
          <li key={t}>
            {TIER_NAMES[t]}: ${PLAN_PRICES[t].monthly / 100}/month or ${PLAN_PRICES[t].yearly / 100}/year · {VIDEO_LIMITS[t]} videos a
            month{tierHasScratch(t) ? " + start from scratch" : ""}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={run}
        disabled={state.busy}
        className="w-fit cursor-pointer rounded-full bg-white/10 px-4 py-2 font-medium hover:bg-white/15 disabled:opacity-50"
      >
        {state.busy ? "working…" : "create the plan prices in Stripe"}
      </button>
      {state.done && (
        <ul className="flex flex-col gap-0.5 text-xs text-emerald-300">
          {state.done.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {state.error && <p className="text-xs text-coral">{state.error}</p>}
    </div>
  );
}
