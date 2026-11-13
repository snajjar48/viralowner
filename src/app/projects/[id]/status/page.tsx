import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { listRenders } from "@/lib/projects";
import { syncUnfinished } from "@/lib/renders";
import { StatusTracker } from "./status-tracker";

export const metadata: Metadata = {
  title: "viralowner — making your video",
  robots: { index: false, follow: false },
};

export default function StatusPage({ params, searchParams }: PageProps<"/projects/[id]/status">) {
  return (
    <Suspense
      fallback={
        <FlowShell>
          <PageSkeleton />
        </FlowShell>
      }
    >
      {Promise.all([params, searchParams]).then(([{ id }, query]) => (
        <Status id={id} renderId={typeof query.render === "string" ? query.render : null} />
      ))}
    </Suspense>
  );
}

async function Status({ id, renderId }: { id: string; renderId: string | null }) {
  const { userId, project } = await loadProject(id, `/projects/${id}/status`);
  const renders = await syncUnfinished(id, await listRenders(userId, id));
  const render = renders.find((r) => r.id === renderId) ?? renders.at(-1);
  if (!render) redirect(project.kind === "scratch" ? `/projects/${id}/create` : `/projects/${id}/options`);
  if (render.status === "done") redirect(`/projects/${id}/preview?v=${render.version}`);

  return (
    <FlowShell projectId={id}>
      {/* Keyed by version: the router keeps a page's state when you come back to it, and a new
          version (regenerate, a change) must start fresh rather than show the last one's progress. */}
      <StatusTracker
        key={render.id}
        projectId={id}
        renderId={render.id}
        scratch={project.kind === "scratch"}
        initial={{
          version: render.version,
          status: render.status,
          stage: render.stage,
          progress: render.progress,
          error: render.error,
        }}
      />
    </FlowShell>
  );
}
