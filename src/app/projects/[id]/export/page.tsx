import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CopyButton } from "@/components/copy-button";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { ArrowLeftIcon } from "@/components/icons";
import { Section } from "@/components/options-fields";
import { loadProject } from "@/lib/project-page";
import { listRenders } from "@/lib/projects";
import type { MusicMode } from "@/lib/video-options";
import { SaveVideo } from "./save-video";

export const metadata: Metadata = {
  title: "download",
  robots: { index: false, follow: false },
};

const SOUND_TIP =
  "add the trending sound inside tiktok or instagram when you post, so you get the boost without copyright issues. (business accounts can only pick from the app’s commercial music library.)";
const TIPS = [
  "post when your audience is online. your app’s insights show the best times.",
  "write a hook in the first line of your caption. it shows before “more”.",
  "reply to the first few comments quickly. it tells the app people care.",
  "post the same video to tiktok, reels and shorts. it’s free extra reach.",
];

/** The sound tip only helps when the video doesn't already have its music. */
const tipsFor = (music: MusicMode) => (music === "none" || music === "original" ? [SOUND_TIP, ...TIPS] : TIPS);

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

  const copy = render.postCopy ?? { caption: "", hashtags: [] };
  const hashtags = copy.hashtags.join(" ");
  const post = [copy.caption, hashtags].filter(Boolean).join("\n\n");

  return (
    <FlowShell projectId={id}>
      <Link
        href={`/projects/${id}/preview?v=${render.version}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
      >
        <ArrowLeftIcon className="size-4" /> back to your video
      </Link>
      <PageTitle title="ready to post" subtitle={`version ${render.version} · 1080×1920 mp4, full hd for tiktok, reels and shorts.`} />

      <SaveVideo
        fileUrl={`/api/projects/${id}/renders/${render.id}/file`}
        fileName={`viralowner-video-v${render.version}.mp4`}
      />

      {post && (
        <Section title="your post" aside={<CopyButton text={post} label="copy caption and hashtags" display="copy all" />}>
          <div className="flex flex-col gap-3">
            {copy.caption && (
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-foreground/90">{copy.caption}</p>
                {hashtags && <CopyButton text={copy.caption} label="copy caption only" />}
              </div>
            )}
            {(copy.alternates ?? []).length > 0 && (
              <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
                <p className="text-xs text-muted">or try one of these</p>
                {(copy.alternates ?? []).map((a) => (
                  <div key={a} className="flex items-start justify-between gap-3">
                    <p className="text-sm text-foreground/80">{a}</p>
                    <CopyButton text={hashtags ? `${a}\n\n${hashtags}` : a} label="copy this caption with the hashtags" />
                  </div>
                ))}
              </div>
            )}
            {copy.hashtags.length > 0 && (
              <div className="flex items-start justify-between gap-3">
                <ul className="flex flex-wrap gap-2" aria-label="hashtags">
                  {copy.hashtags.map((h) => (
                    <li key={h} className="rounded-full bg-white/[0.06] px-3 py-1 text-sm">
                      {h}
                    </li>
                  ))}
                </ul>
                {copy.caption && <CopyButton text={hashtags} label="copy hashtags only" />}
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="posting tips">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground/90 marker:text-coral">
          {tipsFor(render.settings.options.music.mode).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Section>
    </FlowShell>
  );
}
