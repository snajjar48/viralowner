import type { Metadata } from "next";
import { FirstTimeTip } from "@/components/first-time-tip";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CategorySetting } from "@/components/category-setting";
import { FlowShell, PageSkeleton } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { getInspiration, listRenders } from "@/lib/projects";
import { createDownloadUrl } from "@/lib/storage";
import { BreakdownView } from "./breakdown-view";
import { InspoStatus } from "./inspo-status";

export const metadata: Metadata = {
  title: "the video, broken down",
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
  // No inspo, or one picked and uploaded but never confirmed for analysis: pick it (again).
  if (!inspo || inspo.status === "uploading") redirect(`/projects/${id}/inspo`);

  if (inspo.status !== "ready" || !inspo.breakdown) {
    return (
      <FlowShell step={1} projectId={id}>
        <InspoStatus projectId={id} status={inspo.status} error={inspo.error} />
      </FlowShell>
    );
  }

  const [videoUrl, versions] = await Promise.all([
    createDownloadUrl(inspo.storageKey, { expiresIn: 6 * 3600 }),
    listRenders(userId, id),
  ]);
  return (
    <FlowShell step={1} projectId={id}>
      <div className="mb-6 flex flex-col gap-4">
        <FirstTimeTip id="shot-list" title="this is your shot list">
          <p>
            we broke the video into shots. each one tells you what to film and about how long it runs. close enough works
            great.
          </p>
          <p>you don’t need a new clip for every shot: we can use different parts of the same clip.</p>
        </FirstTimeTip>
        <CategorySetting projectId={id} category={project.category} />
      </div>
      <BreakdownView projectId={id} breakdown={inspo.breakdown} videoUrl={videoUrl} hasVersions={versions.length > 0} />
    </FlowShell>
  );
}
