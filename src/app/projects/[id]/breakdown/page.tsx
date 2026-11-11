import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { buttonClass } from "@/components/form";
import { ArrowRightIcon } from "@/components/icons";
import { ShotList } from "@/components/shot-list";
import { VideoPlayer } from "@/components/video-player";
import { loadProject } from "@/lib/project-page";
import { getInspiration } from "@/lib/projects";
import { createDownloadUrl } from "@/lib/storage";
import { formatDuration } from "@/lib/video-options";
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
  const { userId } = await loadProject(id, `/projects/${id}/breakdown`);
  const inspo = await getInspiration(userId, id);
  if (!inspo) redirect(`/projects/${id}/inspo`);

  if (inspo.status !== "ready" || !inspo.breakdown) {
    return (
      <FlowShell step={1} projectId={id}>
        <InspoStatus projectId={id} status={inspo.status} error={inspo.error} />
      </FlowShell>
    );
  }

  const b = inspo.breakdown;
  const videoUrl = await createDownloadUrl(inspo.storageKey, { expiresIn: 6 * 3600 });
  const stats = [
    { label: "length", value: formatDuration(b.durationS) },
    { label: "shots", value: String(b.shotCount) },
    { label: "pacing", value: b.pacing.description },
    { label: "text overlays", value: b.textOverlays.present ? `yes, ${b.textOverlays.style}` : "none" },
    { label: "captions", value: b.captionStyle },
  ];

  return (
    <FlowShell step={1} projectId={id}>
      <PageTitle
        title="here’s how your inspo is built"
        subtitle="film one clip for each shot below. it doesn’t have to be perfect. close enough works great."
      />

      <section aria-label="summary" className="flex gap-4">
        <VideoPlayer src={videoUrl} size="sm" label="your inspo video" className="w-32 sm:w-40" />
        <dl className="grid flex-1 grid-cols-1 content-start gap-2 min-[420px]:grid-cols-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="text-sm font-medium">{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="shots-heading" className="flex flex-col gap-3">
        <h2 id="shots-heading" className="text-lg font-medium">
          your shot list
        </h2>
        <ShotList shots={b.shots} />
      </section>

      <div className="sticky bottom-4 flex flex-col gap-3 pt-2">
        <Link href={`/projects/${id}/clips`} className={`${buttonClass} flex items-center justify-center gap-2`}>
          looks good, upload my clips <ArrowRightIcon className="size-4" />
        </Link>
      </div>
      <Link
        href={`/projects/${id}/inspo`}
        className="self-center text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        use a different inspo
      </Link>
    </FlowShell>
  );
}
