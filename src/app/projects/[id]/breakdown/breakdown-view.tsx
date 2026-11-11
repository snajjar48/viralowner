import Link from "next/link";
import { PageTitle } from "@/components/flow-shell";
import { buttonClass } from "@/components/form";
import { ArrowRightIcon, SparkleIcon } from "@/components/icons";
import { ShotList } from "@/components/shot-list";
import { VideoPlayer } from "@/components/video-player";
import type { Breakdown } from "@/lib/processing/types";
import { formatDuration } from "@/lib/video-options";

/** The finished breakdown: summary, why it works, and the shot list. */
export function BreakdownView({ projectId, breakdown: b, videoUrl }: { projectId: string; breakdown: Breakdown; videoUrl: string }) {
  const stats = [
    { label: "length", value: formatDuration(b.durationS) },
    { label: "shots", value: String(b.shotCount) },
    { label: "pacing", value: b.pacing.description },
    { label: "text overlays", value: b.textOverlays.present ? (b.textOverlays.style ?? "yes") : "none" },
    { label: "captions", value: b.captionStyle },
  ];

  return (
    <>
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

      {b.insights && (
        <section
          aria-labelledby="why-heading"
          className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
        >
          <h2 id="why-heading" className="flex items-center gap-2 text-lg font-medium">
            <SparkleIcon className="size-4 text-coral" /> why it works
          </h2>
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">the hook</dt>
              <dd>{b.insights.hook}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">the structure</dt>
              <dd>{b.insights.structure}</dd>
            </div>
            {b.insights.whyItWorks.length > 0 && (
              <div>
                <dt className="text-xs text-muted">why people watch to the end</dt>
                <dd>
                  <ul className="mt-1 flex flex-col gap-1.5">
                    {b.insights.whyItWorks.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-2 size-1.5 shrink-0 rounded-full bg-linear-to-r from-violet to-coral"
                        />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {b.insights.audio && (
              <div>
                <dt className="text-xs text-muted">sound</dt>
                <dd>{b.insights.audio}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <section aria-labelledby="shots-heading" className="flex flex-col gap-3">
        <h2 id="shots-heading" className="text-lg font-medium">
          your shot list
        </h2>
        <ShotList shots={b.shots} detailed />
      </section>

      <div className="sticky bottom-4 flex flex-col gap-3 pt-2">
        <Link href={`/projects/${projectId}/clips`} className={`${buttonClass} flex items-center justify-center gap-2`}>
          looks good, upload my clips <ArrowRightIcon className="size-4" />
        </Link>
      </div>
      <Link
        href={`/projects/${projectId}/inspo`}
        className="self-center text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        use a different inspo
      </Link>
    </>
  );
}
