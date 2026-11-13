import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { audioView } from "@/lib/audio";
import { canUseScratch, getMembership } from "@/lib/membership";
import { loadProject } from "@/lib/project-page";
import { listClips, listRenders } from "@/lib/projects";
import { createDownloadUrl } from "@/lib/storage";
import { scratchOptions } from "@/lib/video-options";
import { ScratchCreate } from "./scratch-create";

export const metadata: Metadata = {
  title: "viralowner — start from scratch",
  robots: { index: false, follow: false },
};

// "Start from scratch": the prompt, the clips, an optional audio file and the edit options.
export default function CreatePage({ params }: PageProps<"/projects/[id]/create">) {
  return (
    <Suspense
      fallback={
        <FlowShell width="wide">
          <PageSkeleton />
        </FlowShell>
      }
    >
      {params.then(({ id }) => (
        <Create id={id} />
      ))}
    </Suspense>
  );
}

async function Create({ id }: { id: string }) {
  const { userId, project } = await loadProject(id, `/projects/${id}/create`);
  if (project.kind !== "scratch") redirect(`/projects/${id}/breakdown`);
  const [clips, renders, membership] = await Promise.all([
    listClips(userId, id),
    listRenders(userId, id),
    getMembership(userId),
  ]);
  // Once a version exists, the video is edited from its preview page.
  const latest = renders.at(-1);
  if (latest) redirect(latest.status === "done" ? `/projects/${id}/preview` : `/projects/${id}/status?render=${latest.id}`);
  if (!canUseScratch(membership)) redirect("/scratch");

  const initialClips = await Promise.all(
    clips.map(async (c) => ({
      id: c.id,
      fileName: c.fileName,
      durationS: c.durationS,
      shotIndex: null,
      status: c.status,
      previewUrl: c.status === "uploaded" ? await createDownloadUrl(c.storageKey, { expiresIn: 6 * 3600 }) : null,
    })),
  );
  const audio = await audioView(project.audio);

  return (
    <FlowShell projectId={id} width="wide">
      <PageTitle
        title="start from scratch"
        subtitle="add your clips and tell claude what you want. it watches everything and edits the whole video for you."
      />
      <ScratchCreate
        projectId={id}
        initialPrompt={project.prompt}
        initialOptions={scratchOptions(project.settings)}
        initialClips={initialClips}
        rightsConfirmed={project.clipsRightsConfirmedAt !== null}
        initialAudio={audio}
      />
    </FlowShell>
  );
}
