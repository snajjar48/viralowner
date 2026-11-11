import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CopyButton } from "@/components/copy-button";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { buttonClass } from "@/components/form";
import { ArrowLeftIcon } from "@/components/icons";
import { Section } from "@/components/options-fields";
import { loadProject } from "@/lib/project-page";
import { listRenders } from "@/lib/projects";
import { createDownloadUrl } from "@/lib/storage";

export const metadata: Metadata = {
  title: "viralowner — download",
  robots: { index: false, follow: false },
};

const TIPS = [
  "add the trending sound inside tiktok or instagram when you post, so you get the boost without copyright issues.",
  "post when your audience is online. your app’s insights show the best times.",
  "write a hook in the first line of your caption. it shows before “more”.",
  "reply to the first few comments quickly. it tells the app people care.",
  "post the same video to tiktok, reels and shorts. it’s free extra reach.",
];

export default function ExportPage({ params, searchParams }: PageProps<"/projects/[id]/export">) {
  return (
    <Suspense
      fallback={
        <FlowShell>
          <PageSkeleton />
        </FlowShell>
      }
    >
      {Promise.all([params, searchParams]).then(([{ id }, query]) => (
        <Export id={id} version={Number(query.v) || null} />
      ))}
    </Suspense>
  );
}

async function Export({ id, version }: { id: string; version: number | null }) {
  const { userId } = await loadProject(id, `/projects/${id}/export`);
  const done = (await listRenders(userId, id)).filter((r) => r.status === "done" && r.storageKey);
  const render = done.find((r) => r.version === version) ?? done.at(-1);
  if (!render) redirect(`/projects/${id}/preview`);

  const downloadUrl = await createDownloadUrl(render.storageKey!, {
    expiresIn: 3600,
    downloadName: `viralowner-video-v${render.version}.mp4`,
  });
  const copy = render.postCopy ?? { caption: "", hashtags: [] };
  const hashtags = copy.hashtags.join(" ");

  return (
    <FlowShell projectId={id}>
      <Link
        href={`/projects/${id}/preview?v=${render.version}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
      >
        <ArrowLeftIcon className="size-4" /> back to your video
      </Link>
      <PageTitle title="ready to post" subtitle={`version ${render.version} · 1080×1920 mp4, full hd for tiktok, reels and shorts.`} />

      <a href={downloadUrl} download className={`${buttonClass} flex items-center justify-center`}>
        download video
      </a>
      <p className="-mt-3 text-center text-xs text-muted">on iphone: tap download, then share → save video.</p>

      {copy.caption && (
        <Section title="suggested caption" aside={<CopyButton text={copy.caption} label="copy caption" />}>
          <p className="text-sm text-foreground/90">{copy.caption}</p>
        </Section>
      )}
      {copy.hashtags.length > 0 && (
        <Section title="hashtags" aside={<CopyButton text={hashtags} label="copy hashtags" />}>
          <ul className="flex flex-wrap gap-2" aria-label="hashtags">
            {copy.hashtags.map((h) => (
              <li key={h} className="rounded-full bg-white/[0.06] px-3 py-1 text-sm">
                {h}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="posting tips">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground/90 marker:text-coral">
          {TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Section>

      <button
        type="button"
        disabled
        aria-describedby="share-soon"
        className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] text-sm text-muted"
      >
        share to tiktok / instagram
        <span id="share-soon" className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
          coming soon
        </span>
      </button>
    </FlowShell>
  );
}
