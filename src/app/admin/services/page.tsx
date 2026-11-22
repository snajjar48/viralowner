import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { services, stripeSummary } from "@/lib/admin-data";
import { workerHealth } from "@/lib/worker";
import { AdminShell, Badge, Card } from "../ui";
import { PlanPricesButton } from "./plan-prices-button";

export const metadata: Metadata = { title: "admin · services", robots: { index: false, follow: false } };

export default function AdminServicesPage() {
  return (
    <AdminShell title="connected services">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Services />
      </Suspense>
    </AdminShell>
  );
}

async function Services() {
  await requireAdmin();
  const [worker, stripe] = await Promise.all([workerHealth().catch(() => null), stripeSummary()]);
  const status: Record<string, { ok: boolean; note: string } | undefined> = {
    Stripe: stripe.ok ? { ok: true, note: `${stripe.active} active viralowner subscriptions` } : { ok: false, note: stripe.error },
    Modal: worker
      ? { ok: worker.ok, note: Object.entries(worker.checks).map(([k, c]) => `${k} ${c.ok ? "ok" : "problem"}`).join(" · ") }
      : { ok: false, note: "the worker didn’t answer" },
    Anthropic: worker ? { ok: worker.checks.claude.ok, note: worker.checks.claude.ok ? "the editor can reach it" : "the editor can’t reach it (credits?)" } : undefined,
    "Cloudflare R2": worker ? { ok: worker.checks.storage.ok, note: worker.checks.storage.ok ? "the worker can read and write" : "the worker can’t reach storage" } : undefined,
  };
  return (
    <div className="flex flex-col gap-4">
    <Card title="plans in Stripe">
      <p className="text-sm text-muted">
        makes Basic, Plus and Pro (monthly and yearly) in Stripe and switches the site to them. safe to press again: it only
        makes what’s missing or changed.
      </p>
      <PlanPricesButton />
    </Card>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {services().map((s) => {
        const st = status[s.name];
        return (
          <Card
            key={s.name}
            title={s.name}
            aside={st ? <Badge tone={st.ok ? "good" : "bad"}>{st.ok ? "ok" : "check"}</Badge> : undefined}
          >
            <p className="text-sm text-muted">{s.what}</p>
            {st && <p className="text-xs">{st.note}</p>}
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto w-fit rounded-full bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15"
            >
              manage in {s.name} ↗
            </a>
          </Card>
        );
      })}
    </div>
    </div>
  );
}
