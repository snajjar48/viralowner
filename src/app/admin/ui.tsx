import Link from "next/link";
import type { ReactNode } from "react";
import { BackgroundGlow, Logo } from "@/components/auth-layout";
import { AdminSignOut } from "./sign-out";

const NAV = [
  { href: "/admin", label: "overview" },
  { href: "/admin/users", label: "users" },
  { href: "/admin/videos", label: "videos" },
  { href: "/admin/feedback", label: "feedback" },
  { href: "/admin/waitlist", label: "waitlist" },
  { href: "/admin/services", label: "services" },
];

/** The admin pages' frame: private, owner-only. */
export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative isolate min-h-dvh">
      <BackgroundGlow />
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo className="h-6 w-auto" />
            <span className="rounded-full bg-coral/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-coral uppercase">admin</span>
          </div>
          <nav aria-label="admin" className="flex flex-wrap items-center gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-muted hover:bg-white/5 hover:text-foreground">
                {n.label}
              </Link>
            ))}
            <AdminSignOut />
          </nav>
        </div>
      </header>
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-coral" : tone === "good" ? "text-emerald-300" : ""}`}>
        {value}
      </span>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}

export function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "bad" | "warn" | "neutral" }) {
  const c = {
    good: "bg-emerald-400/15 text-emerald-300",
    bad: "bg-coral/15 text-coral",
    warn: "bg-amber-300/15 text-amber-200",
    neutral: "bg-white/10 text-foreground/80",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${c}`}>{children}</span>;
}

export const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

export function bytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function when(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export function statusTone(status: string): "good" | "bad" | "warn" | "neutral" {
  if (["done", "active", "trialing", "paid"].includes(status)) return "good";
  if (["failed", "past_due", "unpaid", "canceled", "incomplete_expired", "uncollectible"].includes(status)) return "bad";
  if (["processing", "queued", "incomplete", "open"].includes(status)) return "warn";
  return "neutral";
}
