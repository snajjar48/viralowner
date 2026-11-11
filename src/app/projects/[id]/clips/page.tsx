import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle, StateCard } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";

export const metadata: Metadata = {
  title: "viralowner — upload your clips",
  robots: { index: false, follow: false },
};

// Placeholder until phase 3 (clip uploads).
export default function ClipsPage({ params }: PageProps<"/projects/[id]/clips">) {
  return (
    <Suspense fallback={<FlowShell step={2}><PageSkeleton /></FlowShell>}>
      {params.then(({ id }) => (
        <Clips id={id} />
      ))}
    </Suspense>
  );
}

async function Clips({ id }: { id: string }) {
  await loadProject(id, `/projects/${id}/clips`);
  return (
    <FlowShell step={2} projectId={id}>
      <PageTitle title="upload your clips" />
      <StateCard title="clip uploads are coming in the next update">
        <Link href={`/projects/${id}/breakdown`} className="text-sm text-muted underline underline-offset-4 hover:text-foreground">
          back to your shot list
        </Link>
      </StateCard>
    </FlowShell>
  );
}
