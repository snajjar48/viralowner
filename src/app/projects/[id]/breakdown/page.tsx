import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { getInspiration } from "@/lib/projects";
import { createDownloadUrl } from "@/lib/storage";
import { BreakdownView } from "./breakdown-view";
import { InspoStatus } from "./inspo-status";

export const metadata: Metadata = {
  title: "viralowner — your inspo, broken down",
  robots: { index: false, follow: false },
};

export default function BreakdownPage({ params }: PageProps<"/projects/[id]/breakdown">) {
  return (
    <Suspense fallback={<FlowShell step={1}><PageSkeleton /></FlowShell>}>
      {params.then(({ id }) => (
        <Breakdown id={id} />
      ))}
    </Suspense>
  );
}

async function Breakdown({ id }: { id: string }) {
  const { userId, project } = await loadProject(id, `/projects/${id}/breakdown`);
  if (project.kind === "scratch") redirect(`/projects/${id}/create`); // "start from scratch" has no inspo steps
  const inspo = await getInspiration(userId, id);
  if (!inspo) redirect(`/projects/${id}/inspo`);

  if (inspo.status !== "ready" || !inspo.breakdown) {
    return (
      <FlowShell step={1} projectId={id}>
        <InspoStatus projectId={id} status={inspo.status} error={inspo.error} />
      </FlowShell>
    );
  }

  const videoUrl = await createDownloadUrl(inspo.storageKey, { expiresIn: 6 * 3600 });
  return (
    <FlowShell step={1} projectId={id}>
      <BreakdownView projectId={id} breakdown={inspo.breakdown} videoUrl={videoUrl} />
    </FlowShell>
  );
}
