import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { JsonLd, ORGANIZATION } from "@/components/structured-data";
import Link from "next/link";
import { TrendIcon, WandIcon } from "@/components/icons";
import { FEATURES, HOME_FAQ, HOW_IT_WORKS, WHO } from "@/components/marketing-copy";
import { Faq, FeatureGrid, HeroVisual, JoinCta, JoinSection, MarketingShell, Section, Steps } from "@/components/marketing";

export const metadata: Metadata = pageMetadata({
  title: "viralowner: edit your clips like viral TikToks & Reels",
  absoluteTitle: true,
  description:
    "send a video that went viral and your own clips. we edit yours the same way, captioned and ready for TikTok, Reels and Shorts. first video free.",
  path: "/",
});

export default function Home() {
  return (
    <MarketingShell>
      <JsonLd data={ORGANIZATION} />
      <section className="px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col items-start gap-6">
            <p className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted">
              the viral video editor for business owners &amp; creators
            </p>
            <h1 className="text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-7xl">
              skip the editing,{" "}
              <span className="bg-linear-to-r from-violet to-coral bg-clip-text text-transparent">keep the views.</span>
            </h1>
            <p className="max-w-xl text-lg text-pretty text-muted sm:text-xl">
              send us a video that went viral and your own raw clips. we edit yours the same way, with your business,
              your words and your spin on it.
            </p>
            <JoinCta id="hero" source="home-hero" />
          </div>
          <HeroVisual />
        </div>
      </section>

      <Section
        id="how"
        eyebrow="how it works"
        title="three steps. none of them are editing."
        intro="you bring the idea and the footage. we do the part that usually takes all night."
      >
        <Steps steps={HOW_IT_WORKS} />
      </Section>

      <Section eyebrow="two ways to start" title="remake what’s working, or start from an idea.">
        <div className="grid gap-4 md:grid-cols-2">
          <WayCard
            icon={<TrendIcon className="size-5" />}
            title="remake a viral video"
            body="pick a video that’s already working. we follow its format with your clips: same structure, same rhythm, your business."
          />
          <WayCard
            icon={<WandIcon className="size-5" />}
            title="start from scratch"
            badge="Pro"
            body="no video in mind? describe what you want, like you would to an editor, add your clips, and we plan the whole edit."
          />
        </div>
      </Section>

      <Section
        eyebrow="what you get"
        title="everything a good editor does, without the back-and-forth."
        intro="every video comes back captioned, timed and ready to post, plus a caption for the post itself."
      >
        <FeatureGrid items={FEATURES} />
      </Section>

      <Section eyebrow="who it’s for" title="if you sell something and you’re on your phone anyway, it’s for you.">
        <ul className="flex flex-wrap gap-2">
          {WHO.map((w) => (
            <li key={w} className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm">
              {w}
            </li>
          ))}
        </ul>
        <p className="max-w-2xl text-pretty text-muted">
          tell us your business once (your name, what you sell, how you talk and what to never say) and every video
          remembers it.
        </p>
      </Section>

      <Section eyebrow="pricing" title="your first video is free.">
        <div className="flex flex-col items-start gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <p className="max-w-xl text-pretty text-muted">
            make one video, ask for a change, download it. then pick a monthly plan if you want more, with up to 30
            videos a month and 3 changes on each.
          </p>
          <Link
            href="/pricing"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-white/15 px-5 text-sm font-medium transition hover:bg-white/10"
          >
            see pricing <span aria-hidden="true">→</span>
          </Link>
        </div>
      </Section>

      <Section eyebrow="questions" title="good questions.">
        <div className="max-w-3xl">
          <Faq items={HOME_FAQ} />
        </div>
      </Section>

      <JoinSection source="home" />
    </MarketingShell>
  );
}

function WayCard({ icon, title, body, badge }: { icon: React.ReactNode; title: string; body: string; badge?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-linear-to-br from-violet to-coral text-white">
        {icon}
      </span>
      <h3 className="flex items-center gap-2 text-xl font-semibold">
        {title}
        {badge && (
          <span className="rounded-full bg-linear-to-r from-violet to-coral px-2 py-0.5 text-[11px] font-medium text-white">
            {badge}
          </span>
        )}
      </h3>
      <p className="text-pretty text-muted">{body}</p>
    </div>
  );
}

