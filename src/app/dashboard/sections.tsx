import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/form";
import { hasBusiness, type BusinessProfile } from "@/lib/business";
import { ArrowRightIcon, TrendIcon, WandIcon } from "@/components/icons";
import { canStartVideo, formatResetDate, type Membership } from "@/lib/membership";
import { CHANGES_PER_VIDEO, TIER_NAMES, TRIAL_CHANGES } from "@/lib/plan-format";
import { ManageBillingButton } from "./manage-billing-button";
import type { ProjectCardData } from "./project-card";
import { SignOutButton } from "./sign-out-button";
import { VideoLibrary } from "./video-library";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Payment overdue: please update your card",
  incomplete: "Payment not completed",
  incomplete_expired: "Payment not completed",
  canceled: "Canceled",
  unpaid: "Unpaid",
  paused: "Paused",
};

export function PlanPill({ m }: { m: Membership }) {
  const text = m.unlimited
    ? "unlimited"
    : m.plan && m.videos
      ? `${TIER_NAMES[m.plan.tier]} · ${Math.max(0, m.videos.limit - m.videos.used)} left`
      : m.plan
        ? TIER_NAMES[m.plan.tier]
        : m.trial === "available"
          ? "free video ready"
          : null;
  if (!text) return null;
  return (
    <a
      href="#account"
      className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-foreground/85 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral lg:inline-block"
    >
      {text}
    </a>
  );
}

export function CreateCards({ m }: { m: Membership }) {
  const can = canStartVideo(m);
  if ("reason" in can) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <p className="text-pretty text-muted">{can.message}</p>
        {can.reason === "subscribe" ? (
          <Link href="/plans" className={`${buttonClass} flex items-center justify-center px-6`}>
            choose a plan
          </Link>
        ) : (
          m.plan?.tier === "basic" && <ManageBillingButton label="upgrade to Pro" />
        )}
      </section>
    );
  }
  const pro = !!(m.plan || m.unlimited);
  return (
    <section aria-label="make a video" className={`grid grid-cols-1 gap-3 ${pro ? "sm:grid-cols-2" : ""}`}>
      <CreateCard
        href="/new"
        icon={<TrendIcon className="size-5" />}
        title={can.as === "trial" ? "make my free video" : "remake a viral video"}
        body="upload a video that went viral. we remake it with your clips, your business and your words."
        primary
      />
      {pro && (
        <CreateCard
          href="/scratch"
          icon={<WandIcon className="size-5" />}
          title="start from scratch"
          badge="Pro"
          body="describe the video you want and add your clips. we plan the edit, text and captions."
        />
      )}
    </section>
  );
}

export function CreateCard({
  href,
  icon,
  title,
  body,
  badge,
  primary,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  body: string;
  badge?: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex flex-col gap-4 overflow-hidden rounded-3xl border p-5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral sm:p-6 ${
        primary
          ? "border-transparent bg-linear-to-br from-violet to-coral text-white shadow-[0_20px_60px_-25px] shadow-coral/60 hover:brightness-110"
          : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.06]"
      }`}
    >
      <span
        className={`flex size-10 items-center justify-center rounded-2xl ${primary ? "bg-white/20" : "bg-white/10 text-foreground"}`}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-lg font-semibold">
          {title}
          {badge && (
            <span className="rounded-full bg-linear-to-r from-violet to-coral px-2 py-0.5 text-[11px] font-medium text-white">
              {badge}
            </span>
          )}
        </span>
        <span className={`text-sm text-pretty ${primary ? "text-white/85" : "text-muted"}`}>{body}</span>
      </span>
      <ArrowRightIcon
        className={`absolute top-5 right-5 size-5 transition group-hover:translate-x-0.5 sm:top-6 sm:right-6 ${primary ? "text-white/80" : "text-muted"}`}
      />
    </Link>
  );
}

export function ProfileCard({ profile }: { profile: BusinessProfile | null }) {
  if (!profile || !hasBusiness(profile)) {
    return (
      <Link
        href="/profile"
        className="group flex items-center justify-between gap-4 rounded-3xl border border-coral/30 bg-coral/[0.06] p-5 transition hover:border-coral/50 focus-visible:outline-2 focus-visible:outline-coral sm:p-6"
      >
        <span className="flex flex-col gap-1">
          <span className="font-medium">tell us about you and your business</span>
          <span className="text-sm text-pretty text-muted">
            your role, what you sell, the words to spell your way, and anything we should remember. two minutes, and every
            video gets it right the first time.
          </span>
        </span>
        <ArrowRightIcon className="size-5 shrink-0 text-coral transition group-hover:translate-x-0.5" />
      </Link>
    );
  }
  const who = [profile.name, profile.role].filter(Boolean).join(" · ");
  const facts = [
    profile.about && { k: "sells", v: profile.about },
    profile.purpose && { k: "for", v: profile.purpose },
    profile.words && { k: "spells", v: profile.words },
    profile.notes && { k: "remembers", v: profile.notes.replace(/\s+/g, " ") },
  ].filter((x): x is { k: string; v: string } => !!x);
  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6" aria-label="your profile">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-violet to-coral text-sm font-semibold text-white uppercase">
            {(profile.name || profile.role || "?").trim().charAt(0)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{who || "your profile"}</span>
            <span className="text-xs text-muted">we use this on every video</span>
          </span>
        </div>
        <Link
          href="/profile"
          className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral"
        >
          edit
        </Link>
      </div>
      {facts.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts.map((f) => (
            <div key={f.k} className="flex min-w-0 gap-2">
              <dt className="w-20 shrink-0 text-muted">{f.k}</dt>
              <dd className="min-w-0 truncate">{f.v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function Account({ m, email }: { m: Membership; email: string }) {
  const rows: [string, string][] = [];
  if (m.unlimited) {
    rows.push(["Plan", "Owner · unlimited"]);
    rows.push(["Videos", "unlimited"]);
    rows.push(["Changes", "unlimited"]);
  } else if (m.plan) {
    rows.push(["Plan", `${TIER_NAMES[m.plan.tier]} · ${m.plan.interval}`]);
    rows.push(["Status", STATUS_LABELS[m.plan.status] ?? m.plan.status]);
    if (m.videos) {
      rows.push(["This month", `${m.videos.used} of ${m.videos.limit} videos used`]);
      rows.push(["Resets", formatResetDate(m.videos.resetsAt)]);
    }
    if (m.plan.periodEnd) {
      rows.push([
        m.plan.cancelAtPeriodEnd ? "Ends" : "Renews",
        new Date(m.plan.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      ]);
    }
    rows.push(["Changes", `${CHANGES_PER_VIDEO} per video`]);
  } else if (m.trial !== "none") {
    rows.push(["Plan", "Free trial"]);
    rows.push(["Free video", m.trial === "available" ? "ready to use" : "used"]);
    rows.push(["Changes", `${TRIAL_CHANGES} on your free video`]);
    rows.push(["Charges", "none. you’re never charged unless you choose a plan"]);
  } else if (m.lapsedStatus) {
    rows.push(["Status", STATUS_LABELS[m.lapsedStatus] ?? m.lapsedStatus]);
  }

  return (
    <section id="account" aria-labelledby="account-heading" className="flex scroll-mt-6 flex-col gap-4">
      <h2 id="account-heading" className="text-xl font-semibold tracking-tight">
        account
      </h2>
      <div className="grid grid-cols-1 gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:p-6">
        {rows.length ? (
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
            <dt className="text-muted">Email</dt>
            <dd className="truncate">{email}</dd>
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted">
            Signed in as {email}. No membership yet.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4 sm:flex-col sm:items-end">
          {m.hasCustomer && m.plan && <ManageBillingButton />}
          {!m.plan && !m.unlimited && (
            <Link href="/plans" className="text-sm font-medium underline underline-offset-4 hover:text-foreground">
              see plans
            </Link>
          )}
          <SignOutButton />
        </div>
      </div>
    </section>
  );
}

export function VideoGrid({ cards }: { cards: ProjectCardData[] | null }) {
  if (!cards) return <p className="text-sm text-coral">couldn’t load your videos. refresh to try again.</p>;
  return <VideoLibrary initial={cards} />;
}
