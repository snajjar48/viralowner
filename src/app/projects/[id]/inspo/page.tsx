import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { InspoUploader } from "@/components/inspo-uploader";

export const metadata: Metadata = {
  title: "viralowner — change your inspo",
  robots: { index: false, follow: false },
};

// Step 1 again, for an existing project: replaces its inspo.
export default function ReplaceInspoPage({ params }: PageProps<"/projects/[id]/inspo">) {
  return (
    <Suspense fallback={<FlowShell step={1}><PageSkeleton /></FlowShell>}>
      {params.then(({ id }) => (
        <ReplaceInspo id={id} />
      ))}
    </Suspense>
  );
}

async function ReplaceInspo({ id }: { id: string }) {
  const { project } = await loadProject(id, `/projects/${id}/inspo`);
  if (project.kind === "scratch") redirect(`/projects/${id}/create`); // "start from scratch" has no inspo steps
  return (
    <FlowShell step={1} projectId={id}>
      <PageTitle
        title="choose a different inspo"
        subtitle="a new inspo means a new shot list. your uploaded clips stay, but you’ll match them to the new shots."
      />
      <InspoUploader projectId={id} />
    </FlowShell>
  );
}
