import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JoinSection, MarketingShell } from "@/components/marketing";
import { ShowcaseGrid, showcaseSchema, ShowcaseTotals } from "@/components/showcase";
import { breadcrumbs, JsonLd } from "@/components/structured-data";
import { SHOWCASE } from "@/content/showcase";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "viral videos made with viralowner",
  description:
    "real TikToks and Reels businesses made from their own clips with viralowner, with their real views, likes, shares and watch time. tap any video to watch it.",
  path: "/made-with-viralowner",
});

export default function MadeWithPage() {
  // Hidden until there are real videos to show.
  if (!SHOWCASE.length) notFound();
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
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-10">
          <ShowcaseTotals />
          <ShowcaseGrid videos={SHOWCASE} />
          <p className="text-xs text-muted">numbers as shown on each post or in its owner’s analytics, on the date under it. some posts only shared some of their numbers.</p>
        </div>
      </section>

      <JoinSection source="made-with" title="your video could be next." />
    </MarketingShell>
  );
}
