import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JoinSection, MarketingShell } from "@/components/marketing";
import { ShowcaseGrid, showcaseSchema } from "@/components/showcase";
import { breadcrumbs, JsonLd } from "@/components/structured-data";
import { compactNumber, SHOWCASE } from "@/content/showcase";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "viral videos made with viralowner",
  description:
    "real TikToks and Reels businesses and creators made from their own clips with viralowner, with their views and likes. tap any video to watch it.",
  path: "/made-with-viralowner",
});

export default function MadeWithPage() {
  // Hidden until there are real videos to show.
  if (!SHOWCASE.length) notFound();
  const views = SHOWCASE.reduce((n, v) => n + v.views, 0);
  const likes = SHOWCASE.reduce((n, v) => n + v.likes, 0);
  return (
    <MarketingShell>
      <JsonLd data={breadcrumbs("made with viralowner", "/made-with-viralowner")} />
      <JsonLd data={showcaseSchema(SHOWCASE)} />
      <section className="px-4 pt-14 pb-10 sm:px-6 sm:pt-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
          <p className="text-sm font-medium bg-linear-to-r from-violet to-coral bg-clip-text text-transparent">
            made with viralowner
          </p>
          <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            viral videos, made from people’s own clips.
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted">
            every one of these was edited with viralowner and posted by the business or creator in it. tap any video to
            watch it.
          </p>
          <dl className="mt-2 flex gap-8 text-center sm:gap-12">
            {[
              [SHOWCASE.length === 1 ? "video" : "videos", String(SHOWCASE.length)],
              ["views", compactNumber(views)],
              ["likes", compactNumber(likes)],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col-reverse">
                <dt className="text-sm text-muted">{k}</dt>
                <dd className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <ShowcaseGrid videos={SHOWCASE} />
          <p className="text-xs text-muted">views and likes as shown on each post on the date under it.</p>
        </div>
      </section>

      <JoinSection source="made-with" title="your video could be next." />
    </MarketingShell>
  );
}
