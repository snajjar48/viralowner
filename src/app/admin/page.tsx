import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { overview, recentVersions } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/admin-auth";
import { lessonsHistory } from "@/lib/lessons";
import { TIER_NAMES, parsePlanId } from "@/lib/plan-format";
import { AdminShell, Badge, Card, Stat, bytes, money } from "./ui";
import { VersionTable } from "./version-table";

export const metadata: Metadata = { title: "admin", robots: { index: false, follow: false } };

export default function AdminOverviewPage() {
  return (
    <AdminShell title="overview">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Overview />
      </Suspense>
    </AdminShell>
  );
}

const planName = (id: string) => {
  const p = parsePlanId(id);
  return p ? `${TIER_NAMES[p.tier]} ${p.interval}` : id;
};

async function Overview() {
  await requireAdmin();
  const [o, recent, lessons] = await Promise.all([overview(), recentVersions(12), lessonsHistory(1)]);
  const s = o.stripe;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="monthly recurring revenue" value={s.ok ? money(s.mrr, s.currency) : "—"} note={s.ok ? `${s.active} active subscriptions` : s.error} />
        <Stat label="revenue, last 30 days" value={s.ok ? money(s.revenue30, s.currency) : "—"} note={s.ok ? `${s.paid30} paid invoices` : undefined} />
        <Stat label="users" value={o.users.total} note={`+${o.users.week} this week`} />
        <Stat label="waitlist" value={o.waitlist.total} note={`+${o.waitlist.week} this week`} />
        <Stat label="videos made, 7 days" value={o.renders.done7} note={`${o.renders.done30} in 30 days`} />
        <Stat
          label="failed versions, 7 days"
          value={o.renders.failed7}
          tone={o.renders.failed7 > 0 ? "bad" : "good"}
          note={o.renders.running ? `${o.renders.running} being made now` : "none running"}
        />
        <Stat label="typical time to make a video" value={o.renders.medianS === null ? "—" : `${Math.round(o.renders.medianS / 6) / 10} min`} note="median, 7 days" />
        <Stat label="clip storage" value={bytes(o.storage.bytes)} note={`${o.storage.clips} clips`} />
        <Stat
          label="feedback"
          value={<Link href="/admin/feedback" className="hover:underline">{o.feedback.total}</Link>}
          note={`+${o.feedback.week} this week · ${o.feedback.unhappy} “not quite”`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="subscriptions">
          {s.ok ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {Object.entries(s.byPlan).map(([id, n]) => (
                <li key={id} className="flex justify-between">
                  <span>{planName(id)}</span>
                  <span className="tabular-nums">{n}</span>
                </li>
              ))}
              {!Object.keys(s.byPlan).length && <li className="text-muted">no paying subscribers yet.</li>}
              {s.canceling > 0 && <li className="text-amber-200">{s.canceling} set to cancel at period end</li>}
              {s.pastDue > 0 && <li className="text-coral">{s.pastDue} past due</li>}
            </ul>
          ) : (
            <p className="text-sm text-coral">{s.error}</p>
          )}
          <p className="text-xs text-muted">viralowner prices only (the Stripe account is shared).</p>
        </Card>

        <Card title="projects">
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex justify-between"><span>all projects</span><span className="tabular-nums">{o.projects.total}</span></li>
            <li className="flex justify-between"><span>this week</span><span className="tabular-nums">{o.projects.week}</span></li>
            <li className="flex justify-between"><span>start from scratch</span><span className="tabular-nums">{o.projects.scratch}</span></li>
            <li className="flex justify-between"><span>counted toward a plan or trial</span><span className="tabular-nums">{o.projects.counted}</span></li>
          </ul>
        </Card>

        <Card title="video worker">
          {o.worker ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {Object.entries(o.worker.checks).map(([k, c]) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span>{k}</span>
                  <Badge tone={c.ok ? "good" : "bad"}>{c.ok ? "ok" : "problem"}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-coral">the worker didn’t answer.</p>
          )}
        </Card>
      </div>

      <Card
        title="what the editor has learned from everyone"
        aside={<Link href="/admin/categories" className="text-sm text-muted underline underline-offset-4 hover:text-foreground">per category</Link>}
      >
        {lessons[0] ? (
          <>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
              {lessons[0].lessons.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ol>
            <p className="text-xs text-muted">
              from {lessons[0].count} change requests, notes and feedback · updated daily · every new version uses these, below the user’s own words.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">nothing yet: it learns once a day from everyone’s change requests, notes and feedback.</p>
        )}
      </Card>

      <Card title="latest versions" aside={<Link href="/admin/videos" className="text-sm text-muted underline underline-offset-4 hover:text-foreground">see all</Link>}>
        <VersionTable rows={recent} />
      </Card>
    </>
  );
}
