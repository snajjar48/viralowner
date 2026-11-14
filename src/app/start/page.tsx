import type { Metadata } from "next";
import { Check, Faq, FeatureGrid, HeroVisual, JoinCta, JoinSection, MarketingShell, Section, Steps } from "@/components/marketing";
import { FEATURES, HOW_IT_WORKS } from "@/components/marketing-copy";

// The page ads point to: one ask, nothing to wander off to. Not for search engines.
export const metadata: Metadata = {
  title: "viralowner — turn your own clips into the video that’s going viral",
  description: "send a video that went viral and your raw clips. get yours back edited, captioned and ready to post. first video free.",
  robots: { index: false, follow: false },
};

export default function AdLandingPage() {
  return (
    <MarketingShell minimal>
      <section className="px-4 pt-10 pb-14 sm:px-6 sm:pt-16 sm:pb-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col items-start gap-6">
            <h1 className="text-4xl leading-[1.04] font-semibold tracking-tight text-balance sm:text-6xl">
              turn your own clips into{" "}
              <span className="bg-linear-to-r from-violet to-coral bg-clip-text text-transparent">the video that’s going viral.</span>
            </h1>
            <p className="max-w-xl text-lg text-pretty text-muted">
              show us a video that’s blowing up and upload your raw clips. we edit yours the same way, with your business in
              it, captioned and ready to post. no editing app, no hours lost.
            </p>
            <ul className="flex flex-col gap-2">
              <Check>no editing skills, no timeline</Check>
              <Check>captions and text in your words, spelled your way</Check>
              <Check>your first video is free</Check>
            </ul>
            <JoinCta id="hero" source="start-hero" />
          </div>
          <HeroVisual />
        </div>
      </section>

      <Section eyebrow="how it works" title="three steps. none of them are editing.">
        <Steps steps={HOW_IT_WORKS} />
      </Section>

      <Section eyebrow="what you get" title="everything a good editor does.">
        <FeatureGrid items={FEATURES} />
      </Section>

      <Section eyebrow="quick answers" title="before you sign up.">
        <div className="max-w-3xl">
          <Faq
            items={[
              {
                q: "do i need editing experience?",
                a: "none. you upload clips and say what you want in plain words.",
              },
              {
                q: "is the first video really free?",
                a: "yes: one video, one change and the download. you’re only ever charged if you choose a plan yourself.",
              },
              {
                q: "does it use my real footage?",
                a: "only your real footage. we follow the viral video’s format; every frame is something you filmed.",
              },
              {
                q: "what kind of business is it for?",
                a: "anyone who sells something and posts on TikTok or Reels: cafés, salons, gyms, shops, real estate, creators and the people who run their socials.",
              },
            ]}
          />
        </div>
      </Section>

      <JoinSection source="start" title="get your first video free." />
    </MarketingShell>
  );
}
