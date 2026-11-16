import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { listFeedback, userDetail } from "@/lib/admin-data";
import { TIER_NAMES } from "@/lib/plan-format";
import { FeedbackPeople } from "../../feedback/feedback-people";
import { AdminShell, Badge, Card, bytes, money, statusTone, when } from "../../ui";

export const metadata: Metadata = { title: "admin · user", robots: { index: false, follow: false } };

export default function AdminUserPage({ params }: PageProps<"/admin/users/[id]">) {
  return (
    <AdminShell title="user">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        {params.then(({ id }) => (
          <User id={id} />
        ))}
      </Suspense>
    </AdminShell>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted">{k}</span>
      <span className="min-w-0 text-right break-words">{v || "—"}</span>
    </div>
  );
}

async function User({ id }: { id: string }) {
  await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [d, feedback] = await Promise.all([userDetail(id), listFeedback(id)]);
  if (!d) notFound();
  const p = d.profile;
  const m = d.membership;
  const videos = d.projects.flatMap((x) => x.versions);
  const done = videos.filter((v) => v.status === "done");
  return (
    <>
      <Link href="/admin/users" className="w-fit text-sm text-muted hover:text-foreground">
        ← all users
      </Link>
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-semibold">{`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email}</h2>
        <span className="text-sm text-muted">{p.email}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="account">
          <Row k="phone" v={p.phone} />
          <Row k="signed up" v={when(d.auth.createdAt)} />
          <Row k="last sign-in" v={when(d.auth.lastSignIn)} />
          <Row k="email confirmed" v={d.auth.confirmed ? "yes" : "no"} />
          <Row k="waitlist" v={d.waitlist ? `${when(d.waitlist.at)}${d.waitlist.source ? ` · ${d.waitlist.source}` : ""}` : "not on it"} />
          <Row k="user id" v={<code className="text-xs">{p.id}</code>} />
        </Card>

        <Card title="plan & usage">
          <Row
            k="plan"
            v={
              m?.tester
                ? "tester · free access"
                : m?.unlimited
                ? "owner · unlimited"
                : m?.plan
                  ? `${TIER_NAMES[m.plan.tier]} ${m.plan.interval} · ${m.plan.status}${m.plan.cancelAtPeriodEnd ? " (cancels at period end)" : ""}`
                  : (p.subscription_status as string) || "no plan"
            }
          />
          {m?.videos && <Row k="this month" v={`${m.videos.used} of ${m.videos.limit} videos`} />}
          <Row k="free trial" v={m?.trial === "used" ? "used" : d.trialClaimedAt ? `claimed ${when(d.trialClaimedAt)}` : "not claimed"} />
          <Row k="projects" v={d.projects.filter((x) => !x.deleted).length} />
          <Row k="videos made" v={`${done.length} versions`} />
          <Row k="failed" v={videos.filter((v) => v.status === "failed").length} />
          <Row k="clip storage" v={bytes(d.storageBytes)} />
        </Card>

        <Card title="business profile">
          {d.business ? (
            <>
              <Row k="name" v={d.business.name} />
              <Row k="role" v={d.business.role} />
              <Row k="sells" v={d.business.about} />
              <Row k="city" v={d.business.city} />
              <Row k="viewers" v={d.business.audience} />
              <Row k="offer" v={d.business.offer} />
              <Row k="for" v={d.business.purpose} />
              <Row k="spells" v={d.business.words} />
              {d.business.notes && <p className="rounded-xl bg-white/[0.04] p-2 text-xs whitespace-pre-wrap">{d.business.notes}</p>}
            </>
          ) : (
            <p className="text-sm text-muted">not filled in.</p>
          )}
        </Card>
      </div>

      <Card
        title="stripe"
        aside={
          d.stripe?.url ? (
            <a href={d.stripe.url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted underline underline-offset-4 hover:text-foreground">
              open in Stripe ↗
            </a>
          ) : undefined
        }
      >
        {!d.stripe ? (
          <p className="text-sm text-muted">no Stripe customer.</p>
        ) : "error" in d.stripe ? (
          <p className="text-sm text-coral">{d.stripe.error}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Row k="card" v={d.stripe.card} />
              {d.stripe.subscriptions.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {s.plan} · since {when(s.created)}
                  </a>
                  <Badge tone={statusTone(s.status)}>{s.status}{s.cancelAtPeriodEnd ? " · canceling" : ""}</Badge>
                </div>
              ))}
              {!d.stripe.subscriptions.length && <p className="text-sm text-muted">no viralowner subscriptions.</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted">invoices</p>
              {d.stripe.invoices.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted">{when(i.created)}</span>
                  <span className="tabular-nums">{money(i.amount, i.currency)}</span>
                  {i.url ? (
                    <a href={i.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      <Badge tone={statusTone(i.status ?? "")}>{i.status}</Badge>
                    </a>
                  ) : (
                    <Badge tone={statusTone(i.status ?? "")}>{i.status}</Badge>
                  )}
                </div>
              ))}
              {!d.stripe.invoices.length && <p className="text-sm text-muted">none.</p>}
            </div>
          </div>
        )}
      </Card>

      {feedback.length > 0 && <FeedbackPeople people={feedback} showPerson={false} />}

      <Card title={`projects (${d.projects.length})`}>
        <div className="flex flex-col gap-3">
          {d.projects.map((x) => (
            <details key={x.id} className="group rounded-xl border border-white/10 p-3">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {x.name || x.prompt.slice(0, 70) || (x.kind === "scratch" ? "from scratch" : "remake")}
                    {x.deleted && <span className="ml-2 text-xs text-coral">deleted</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {x.kind} · {x.versions.length} versions · {x.clips} clips ({bytes(x.bytes)}) · updated {when(x.updatedAt)}
                    {x.billing ? ` · counted as ${x.billing}` : ""}
                  </span>
                </span>
                <Badge tone={statusTone(x.status)}>{x.status}</Badge>
              </summary>
              {x.prompt && <p className="mt-2 rounded-lg bg-white/[0.04] p-2 text-xs whitespace-pre-wrap text-muted">{x.prompt}</p>}
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {x.versions.map((v) => (
                  <li key={v.version} className="flex flex-col gap-1.5 rounded-xl bg-white/[0.03] p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">v{v.version}</span>
                      <Badge tone={statusTone(v.status)}>{v.status}</Badge>
                    </div>
                    {v.url && (
                      <video src={v.url} controls preload="none" playsInline className="aspect-[9/16] w-full rounded-lg bg-black" />
                    )}
                    <span className="text-[11px] text-muted">
                      {when(v.createdAt)}
                      {v.seconds !== null ? ` · took ${Math.floor(v.seconds / 60)}m ${v.seconds % 60}s` : ""}
                    </span>
                    {v.request && <span className="text-[11px]">“{v.request.slice(0, 160)}”</span>}
                    {v.error && <span className="text-[11px] text-coral">{v.error}</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {!d.projects.length && <p className="text-sm text-muted">no projects yet.</p>}
        </div>
      </Card>
    </>
  );
}
