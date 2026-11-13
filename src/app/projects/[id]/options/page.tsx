import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { getInspiration, listClips } from "@/lib/projects";
import { clipThumbUrl } from "@/lib/clips";
import { createDownloadUrl } from "@/lib/storage";
import { isOneTake } from "@/lib/processing/types";
import { OptionsForm } from "./options-form";

export const metadata: Metadata = {
  title: "viralowner — options",
  robots: { index: false, follow: false },
};

// Step 3: optional extras (smart defaults), then "make my video".
export default function OptionsPage({ params }: PageProps<"/projects/[id]/options">) {
  return (
    <Suspense
      fallback={
        <FlowShell step={3}>
          <PageSkeleton />
        </FlowShell>
      }
    >
      {params.then(({ id }) => (
        <Options id={id} />
      ))}
    </Suspense>
  );
}

async function Options({ id }: { id: string }) {
  const { userId, project } = await loadProject(id, `/projects/${id}/options`);
  if (project.kind === "scratch") redirect(`/projects/${id}/create`); // "start from scratch" has no inspo steps
  const [inspo, clips] = await Promise.all([getInspiration(userId, id), listClips(userId, id)]);
  if (!inspo?.breakdown) redirect(`/projects/${id}/breakdown`);
  const uploaded = clips.filter((c) => c.status === "uploaded");
  if (!uploaded.length || !project.clipsRightsConfirmedAt) redirect(`/projects/${id}/clips`);

  const optionClips = await Promise.all(
    uploaded.map(async (c) => ({
      id: c.id,
      fileName: c.fileName,
      durationS: c.durationS,
      shotIndex: c.shotIndex,
      previewUrl: await createDownloadUrl(c.storageKey, { expiresIn: 6 * 3600 }),
      thumbUrl: await clipThumbUrl(c.storageKey),
    })),
  );

  return (
    <FlowShell step={3} projectId={id}>
      <PageTitle title="final touches" subtitle="all optional. the defaults work great, so you can go straight to the button." />
      <OptionsForm
        projectId={id}
        initialOptions={project.settings}
        shots={inspo.breakdown.shots}
        clips={optionClips}
        oneTake={isOneTake(inspo.breakdown)}
        uploadedAudio={project.audio?.status === "uploaded" ? { fileName: project.audio.fileName } : null}
      />
    </FlowShell>
  );
}
