import type { Metadata } from "next";
import { FirstTimeTip } from "@/components/first-time-tip";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { getInspiration, listClips } from "@/lib/projects";
import { isOneTake } from "@/lib/processing/types";
import { clipThumbUrl } from "@/lib/clips";
import { createDownloadUrl } from "@/lib/storage";
import { AudioUploader } from "@/components/audio-uploader";
import { audioView } from "@/lib/audio";
import { ClipsManager } from "./clips-manager";

export const metadata: Metadata = {
  title: "upload your clips",
  robots: { index: false, follow: false },
};

// Step 2: upload your clips and match them to the shot list.
export default function ClipsPage({ params }: PageProps<"/projects/[id]/clips">) {
  return (
    <Suspense
      fallback={
        <FlowShell step={2} width="wide">
          <PageSkeleton />
        </FlowShell>
      }
    >
      {params.then(({ id }) => (
        <Clips id={id} />
      ))}
    </Suspense>
  );
}

async function Clips({ id }: { id: string }) {
  const { userId, project } = await loadProject(id, `/projects/${id}/clips`);
  if (project.kind === "scratch") redirect(`/projects/${id}/create`); // "start from scratch" has no inspo steps
  const [inspo, clips] = await Promise.all([getInspiration(userId, id), listClips(userId, id)]);
  if (!inspo?.breakdown) redirect(`/projects/${id}/breakdown`);

  const initialClips = await Promise.all(
    clips.map(async (c) => ({
      id: c.id,
      fileName: c.fileName,
      durationS: c.durationS,
      shotIndexes: c.shotIndexes,
      multiUse: c.multiUse,
      status: c.status,
      previewUrl: c.status === "uploaded" ? await createDownloadUrl(c.storageKey, { expiresIn: 6 * 3600 }) : null,
      thumbUrl: c.status === "uploaded" ? await clipThumbUrl(c.storageKey) : null,
    })),
  );

  const oneTake = isOneTake(inspo.breakdown);
  const audio = await audioView(project.audio);
  return (
    <FlowShell step={2} projectId={id} width="wide">
      <PageTitle
        title={oneTake ? "now add your take" : "now add your clips"}
        subtitle={
          oneTake
            ? "upload your one long clip of you talking. we’ll cut out the pauses, retakes and “um”s to match the original."
            : "upload the clips you filmed. match each one to a shot, or let us figure it out."
        }
      />
      {oneTake ? (
        <FirstTimeTip id="clips-one-take" title="before you film">
          <p>film vertical, facing the light, and talk straight to the camera.</p>
          <p>don’t worry about mistakes or pauses: keep going and we cut them out.</p>
        </FirstTimeTip>
      ) : (
        <FirstTimeTip id="clips" title="before you film">
          <p>film vertical, facing the light, and keep the camera steady on the big moment.</p>
          <p>film each shot a bit longer than it runs, so we have room to pick the best part.</p>
          <p>upload everything you filmed, in any order. we watch it all and match each clip to its shot.</p>
        </FirstTimeTip>
      )}
      <ClipsManager
        projectId={id}
        oneTake={oneTake}
        shots={inspo.breakdown.shots}
        initialClips={initialClips}
        rightsConfirmed={project.clipsRightsConfirmedAt !== null}
        extra={<AudioUploader projectId={id} initial={audio} />}
      />
    </FlowShell>
  );
}
