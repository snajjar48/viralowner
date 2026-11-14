import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BackgroundGlow, Logo } from "@/components/auth-layout";
import { SiteNav } from "@/components/site-nav";
import { getBusiness } from "@/lib/business";
import { DRAFT_DAYS } from "@/lib/cleanup";
import { clipThumbUrl } from "@/lib/clips";
import { getMembership } from "@/lib/membership";
import { listProjects, projectTitle, resumeHref, type ProjectStatus, type ProjectSummary } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import type { ProjectCardData } from "./project-card";
import { Account, CreateCards, PlanPill, ProfileCard, VideoGrid } from "./sections";

export const metadata: Metadata = {
  title: "viralowner — dashboard",
  robots: { index: false, follow: false },
};

const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: ProjectCardData["tone"] }> = {
  draft: { label: "inspo not analyzed", tone: "draft" },
  analyzing: { label: "analyzing inspo", tone: "working" },
  ready_for_clips: { label: "add your clips", tone: "draft" },
  processing: { label: "editing", tone: "working" },
  done: { label: "ready to post", tone: "ready" },
  failed: { label: "needs another try", tone: "attention" },
};

// Requires the site password AND a signed-in account (see src/proxy.ts).
export default function DashboardPage() {
  return (
    <div className="relative isolate min-h-dvh">
      <BackgroundGlow />
      <Suspense fallback={<p className="pt-32 text-center text-muted">Loading…</p>}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  const [{ data: account }, membership, profile] = await Promise.all([
    supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle(),
    getMembership(user.id),
    getBusiness(user.id),
  ]);
  const firstName = typeof account?.first_name === "string" ? account.first_name.trim() : "";

  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
        <Logo className="h-7 w-auto" />
        <div className="flex items-center gap-2">
          <PlanPill m={membership} />
          <SiteNav />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pt-8 pb-20 sm:px-6 sm:pt-12">
        <section className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {firstName ? `hey, ${firstName}` : "welcome back"}
          </h1>
          <p className="text-muted text-pretty">what are we making today?</p>
        </section>

        <CreateCards m={membership} />

        <ProfileCard profile={profile} />

        <Videos userId={user.id} />

        <Account m={membership} email={user.email ?? ""} />
      </main>
    </>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1 && new Date().getDate() === d.getDate()) return "today";
  if (days < 2) return "yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function cardFor(p: ProjectSummary): Promise<ProjectCardData> {
  const status =
    p.kind === "scratch" && (p.status === "draft" || p.status === "ready_for_clips")
      ? { label: "add your clips", tone: "draft" as const }
      : PROJECT_STATUS[p.status];
  return {
    id: p.id,
    href: resumeHref(p),
    name: p.name,
    fallbackName: projectTitle({ ...p, name: "" }),
    kind: p.kind,
    status: status.label,
    tone: status.tone,
    when: when(p.updatedAt),
    version: p.latestVersion,
    cover: p.coverClipKey ? await clipThumbUrl(p.coverClipKey).catch(() => null) : null,
    prompt: p.prompt,
    busy: p.status === "processing" || p.status === "analyzing",
    // Drafts (no version made yet) are deleted after DRAFT_DAYS untouched.
    deletesInDays: p.counted
      ? null
      : Math.max(1, Math.ceil(DRAFT_DAYS - (Date.now() - new Date(p.lastActiveAt).getTime()) / 86_400_000)),
  };
}

async function Videos({ userId }: { userId: string }) {
  const projects = await listProjects(userId).catch((error) => {
    console.error("Listing projects failed:", error);
    return null;
  });
  return <VideoGrid cards={projects && (await Promise.all(projects.map(cardFor)))} />;
}
