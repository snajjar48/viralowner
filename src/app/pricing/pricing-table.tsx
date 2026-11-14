"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CHANGES_PER_VIDEO,
  formatMoney,
  TRIAL_CHANGES,
  VIDEO_LIMITS,
  type Interval,
  type Plan,
  type Tier,
} from "@/lib/plan-format";

const TIER_INFO: Record<Tier, { tagline: string; extras: string[] }> = {
  basic: {
    tagline: "for posting a few times a week",
    extras: ["remake any viral video", "every caption and text style", "free storyboard preview", "post caption written for you"],
  },
  pro: {
    tagline: "for posting every day",
    extras: ["everything in Basic", "start from scratch: describe it, we plan it", "cut to the beat of your own song"],
  },
};

/** The tiers with a monthly / yearly switch. Prices come from Stripe; null shows the plans without them. */
export function PricingTable({ plans, cta }: { plans: Plan[] | null; cta: { href: string; label: string } }) {
  const [interval, setInterval] = useState<Interval>("monthly");
  const price = (tier: Tier, i: Interval) => plans?.find((p) => p.tier === tier && p.interval === i) ?? null;
  const saving = (() => {
    const m = price("pro", "monthly");
    const y = price("pro", "yearly");
    return m && y && y.amount < m.amount * 12 ? Math.round((1 - y.amount / (m.amount * 12)) * 100) : 0;
  })();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="billing" className="flex rounded-full border border-white/10 bg-white/[0.04] p-1">
          {(["monthly", "yearly"] as const).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-full px-5 text-sm text-muted transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral aria-checked:bg-white aria-checked:font-medium aria-checked:text-black"
            >
              {i}
              {i === "yearly" && saving > 0 && (
                <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300 [[aria-checked=true]_&]:bg-emerald-500/15 [[aria-checked=true]_&]:text-emerald-700">
                  save {saving}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          name="Free trial"
          tagline="try it on your own clips"
          amount="$0"
          per=""
          note="card required, never charged unless you choose a plan"
          items={[
            "1 video",
            `${TRIAL_CHANGES} change to it`,
            "remake a viral video",
            "free storyboard preview",
            "download at full quality",
          ]}
          cta={cta}
        />
        {(["basic", "pro"] as const).map((tier) => {
          const p = price(tier, interval);
          const perMonth = p && interval === "yearly" ? formatMoney(Math.round(p.amount / 12), p.currency) : null;
          return (
            <Card
              key={tier}
              name={tier === "basic" ? "Basic" : "Pro"}
              tagline={TIER_INFO[tier].tagline}
              amount={p ? (perMonth ?? formatMoney(p.amount, p.currency)) : "—"}
              per={p ? "/month" : ""}
              note={
                p
                  ? interval === "yearly"
                    ? `${formatMoney(p.amount, p.currency)} billed once a year`
                    : "billed monthly, cancel anytime"
                  : "pricing coming soon"
              }
              items={[`${VIDEO_LIMITS[tier]} videos a month`, `${CHANGES_PER_VIDEO} changes per video`, ...TIER_INFO[tier].extras]}
              cta={cta}
              featured={tier === "pro"}
            />
          );
        })}
      </div>
    </div>
  );
}

function Card({
  name,
  tagline,
  amount,
  per,
  note,
  items,
  cta,
  featured,
}: {
  name: string;
  tagline: string;
  amount: string;
  per: string;
  note: string;
  items: string[];
  cta: { href: string; label: string };
  featured?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col gap-6 rounded-3xl p-6 sm:p-8 ${
        featured
          ? "border border-transparent bg-linear-to-b from-violet/30 via-[#16141f] to-[#16141f] shadow-[0_30px_80px_-40px] shadow-coral/50 ring-1 ring-coral/40"
          : "border border-white/10 bg-white/[0.03]"
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-linear-to-r from-violet to-coral px-3 py-1 text-xs font-medium text-white">
          includes start from scratch
        </span>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">{name}</h3>
        <p className="text-sm text-muted">{tagline}</p>
      </div>
      <div className="flex flex-col gap-1">
        <p className="flex items-baseline gap-1">
          <span className="text-5xl font-semibold tracking-tight tabular-nums">{amount}</span>
          <span className="text-muted">{per}</span>
        </p>
        <p className="min-h-5 text-xs text-muted">{note}</p>
      </div>
      <Link
        href={cta.href}
        className={`flex h-12 items-center justify-center rounded-full text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral ${
          featured ? "bg-linear-to-r from-violet to-coral text-white hover:brightness-110" : "border border-white/15 bg-white/5 hover:bg-white/10"
        }`}
      >
        {cta.label}
      </Link>
      <ul className="flex flex-col gap-2.5">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2.5 text-sm">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-coral" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
