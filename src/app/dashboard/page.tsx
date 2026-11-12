import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BackgroundGlow } from "@/components/auth-layout";
import Link from "next/link";
import { buttonClass } from "@/components/form";
import { canStartVideo, formatResetDate, getMembership, type Membership } from "@/lib/membership";
import { CHANGES_PER_VIDEO, TIER_NAMES, TRIAL_CHANGES } from "@/lib/plan-format";
import { listProjects, resumeHref, type ProjectStatus } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { formatDuration } from "@/lib/video-options";
import { ManageBillingButton } from "./manage-billing-button";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "viralowner — dashboard",
  robots: { index: false, follow: false },
};

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

const PROJECT_LABELS: Record<ProjectStatus, string> = {
  draft: "inspo not analyzed yet",
  analyzing: "analyzing your inspo",
  ready_for_clips: "ready for your clips",
  processing: "editing your video",
  done: "ready to post",
  failed: "needs another try",
};

// Requires the site password AND a signed-in account (see src/proxy.ts).
export default function DashboardPage() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <BackgroundGlow />
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Account />
      </Suspense>
      <SignOutButton />
    </div>
  );
}

async function Account() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  const [{ data: profile }, membership] = await Promise.all([
    supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle(),
    getMembership(user.id),
  ]);
  const can = canStartVideo(membership);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        You’re in{profile?.first_name ? `, ${profile.first_name}` : ""}.
      </h1>
      <p className="text-muted">Signed in as {user.email}.</p>

      <MembershipCard m={membership} />

      {"reason" in can ? (
        <div className="flex w-full max-w-sm flex-col gap-3">
          <p className="text-sm text-muted text-pretty">{can.message}</p>
          {can.reason === "subscribe" ? (
            <Link href="/plans" className={`${buttonClass} flex items-center justify-center`}>
              choose a plan
            </Link>
          ) : (
            membership.plan?.tier === "basic" && <ManageBillingButton label="upgrade to Pro" />
          )}
        </div>
      ) : (
        <Link href="/new" className={`${buttonClass} flex max-w-sm items-center justify-center`}>
          {can.as === "trial" ? "make my free video" : "make a new video"}
        </Link>
      )}
      {membership.hasCustomer && membership.plan && <ManageBillingButton />}
      <Projects userId={user.id} />
    </>
  );
}

function MembershipCard({ m }: { m: Membership }) {
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
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm">
      {rows.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-left">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted">No membership yet.</p>
      )}
    </div>
  );
}

async function Projects({ userId }: { userId: string }) {
  const projects = await listProjects(userId).catch((error) => {
    console.error("Listing projects failed:", error);
    return null;
  });
  if (!projects) return <p className="text-sm text-coral">couldn’t load your videos. refresh to try again.</p>;
  if (projects.length === 0) {
    return <p className="text-sm text-muted">your videos will show up here.</p>;
  }
  return (
    <section aria-labelledby="videos-heading" className="flex w-full max-w-sm flex-col gap-2 text-left">
      <h2 id="videos-heading" className="text-sm text-muted">
        your videos
      </h2>
      <ul className="flex flex-col gap-2">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={resumeHref(p)}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm transition hover:border-white/25 focus-visible:outline-2 focus-visible:outline-coral"
            >
              <span className="flex flex-col">
                <span className="font-medium">
                  {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {p.inspoDurationS !== null && ` · ${formatDuration(p.inspoDurationS)} inspo`}
                </span>
                <span className="text-muted">{PROJECT_LABELS[p.status]}</span>
              </span>
              <span aria-hidden="true" className="text-muted">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
