import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { getInspiration, listClips } from "@/lib/projects";
import { createDownloadUrl } from "@/lib/storage";
import { ClipsManager } from "./clips-manager";

export const metadata: Metadata = {
  title: "viralowner — upload your clips",
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
  const [inspo, clips] = await Promise.all([getInspiration(userId, id), listClips(userId, id)]);
  if (!inspo?.breakdown) redirect(`/projects/${id}/breakdown`);

  const initialClips = await Promise.all(
    clips.map(async (c) => ({
      id: c.id,
      fileName: c.fileName,
      durationS: c.durationS,
      shotIndex: c.shotIndex,
      status: c.status,
      previewUrl: c.status === "uploaded" ? await createDownloadUrl(c.storageKey, { expiresIn: 6 * 3600 }) : null,
    })),
  );

  return (
    <FlowShell step={2} projectId={id} width="wide">
      <PageTitle
        title="now add your clips"
        subtitle="upload the clips you filmed. match each one to a shot, or let us figure it out."
      />
      <ClipsManager
        projectId={id}
        shots={inspo.breakdown.shots}
        initialClips={initialClips}
        rightsConfirmed={project.clipsRightsConfirmedAt !== null}
      />
    </FlowShell>
  );
}
