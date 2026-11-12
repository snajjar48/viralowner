import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { getInspiration, listClips, listRenders } from "@/lib/projects";
import { syncUnfinished } from "@/lib/renders";
import { createDownloadUrl } from "@/lib/storage";
import { PreviewEditor } from "./preview-editor";

export const metadata: Metadata = {
  title: "viralowner — your video",
  robots: { index: false, follow: false },
};

export default function PreviewPage({ params, searchParams }: PageProps<"/projects/[id]/preview">) {
  return (
    <Suspense
      fallback={
        <FlowShell width="wide">
          <PageSkeleton />
        </FlowShell>
      }
    >
      {Promise.all([params, searchParams]).then(([{ id }, query]) => (
        <Preview id={id} version={Number(query.v) || null} />
      ))}
    </Suspense>
  );
}

async function Preview({ id, version }: { id: string; version: number | null }) {
  const { userId, project } = await loadProject(id, `/projects/${id}/preview`);
  const [renders, clips, inspo] = await Promise.all([
    listRenders(userId, id).then((list) => syncUnfinished(id, list)),
    listClips(userId, id),
    getInspiration(userId, id),
  ]);
  const done = renders.filter((r) => r.status === "done" && r.storageKey);
  const latest = renders.at(-1);
  const inProgress = latest && (latest.status === "queued" || latest.status === "processing") ? latest : null;
  if (!done.length) redirect(latest ? `/projects/${id}/status?render=${latest.id}` : `/projects/${id}/options`);
  if (!inspo?.breakdown) redirect(`/projects/${id}/breakdown`);

  const current = done.find((r) => r.version === version) ?? done.at(-1)!;
  const uploaded = clips.filter((c) => c.status === "uploaded");
  const [videoUrl, clipList] = await Promise.all([
    createDownloadUrl(current.storageKey!, { expiresIn: 6 * 3600 }),
    Promise.all(
      uploaded.map(async (c, i) => ({
        id: c.id,
        label: `clip ${i + 1}`,
        durationS: c.durationS ?? 0,
        previewUrl: await createDownloadUrl(c.storageKey, { expiresIn: 6 * 3600 }),
      })),
    ),
  ]);

  return (
    <FlowShell projectId={id} width="wide">
      <PreviewEditor
        key={current.id}
        projectId={id}
        versions={done.map((r) => r.version)}
        current={{
          version: current.version,
          videoUrl,
          settings: current.settings,
          shots: current.plan?.jumpcut ? [] : (current.plan?.shots ?? current.settings.shots ?? []),
          note: current.plan?.note ?? null,
        }}
        inProgress={inProgress ? { id: inProgress.id, version: inProgress.version } : null}
        failedLatest={latest?.status === "failed" ? { id: latest.id, version: latest.version } : null}
        shots={inspo.breakdown.shots}
        oneTake={!!current.plan?.jumpcut}
        uploadedAudio={project.audio?.status === "uploaded" ? { fileName: project.audio.fileName } : null}
        clips={clipList}
      />
    </FlowShell>
  );
}
