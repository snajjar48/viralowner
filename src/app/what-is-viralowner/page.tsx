import type { Metadata } from "next";
import { Check, Faq, JoinCta, JoinSection, MarketingShell, Section } from "@/components/marketing";
import { WHO } from "@/components/marketing-copy";

export const metadata: Metadata = {
  title: "what is viralowner? — how it works",
  description:
    "viralowner is a video editor that works like a person: show it a video that went viral, hand it your clips, and it edits yours the same way.",
  alternates: { canonical: "/what-is-viralowner" },
};

const PROCESS = [
  {
    title: "we study the video you picked",
    body: "every cut, how long each shot holds, when the text shows up and what it says, how the captions look and where they sit, where the punchline lands and what you hear.",
  },
  {
    title: "we watch your clips",
    body: "what’s in each take, who’s talking and what they say, and the best moment of each one. a clip of you talking is cut on your sentences, never mid-word.",
  },
  {
    title: "we plan your edit",
    body: "which of your clips goes in each shot, the on-screen text rewritten for your business, and where the captions go. you can see the plan as a storyboard before anything is made, free.",
  },
  {
    title: "we make it",
    body: "cut, timed, captioned and exported at full quality, with text kept out of the way of the app’s buttons. usually ready in a few minutes.",
  },
  {
    title: "you make it yours",
    body: "ask for changes in plain words, fix any caption word yourself for free, and download it with a post caption written for it.",
  },
];

export default function WhatIsPage() {
  return (
    <MarketingShell>
      <section className="px-4 pt-14 pb-10 sm:px-6 sm:pt-24">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <p className="text-sm font-medium bg-linear-to-r from-violet to-coral bg-clip-text text-transparent">
            what is viralowner?
          </p>
          <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            a video editor that works like a person, in minutes.
          </h1>
          <p className="text-lg text-pretty text-muted sm:text-xl">
            show it a video that went viral and hand it your raw clips. it edits yours the same way: the same structure,
            the same rhythm, the same kind of text and captions, with your footage, your business and your words.
          </p>
          <JoinCta id="hero" source="what-is-hero" />
        </div>
      </section>

      <Section eyebrow="step by step" title="what happens to your video.">
        <ol className="relative flex max-w-3xl flex-col gap-8 border-l border-white/10 pl-8">
          {PROCESS.map((p, i) => (
            <li key={p.title} className="relative flex flex-col gap-2">
              <span className="absolute top-0 -left-[2.85rem] flex size-8 items-center justify-center rounded-full bg-linear-to-br from-violet to-coral text-sm font-semibold text-white ring-4 ring-background">
                {i + 1}
              </span>
              <h3 className="text-lg font-semibold">{p.title}</h3>
              <p className="text-pretty text-muted">{p.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="no inspo? no problem." title="or just describe it.">
        <div className="grid max-w-4xl gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:grid-cols-[1fr_1fr] sm:p-8">
          <p className="text-pretty text-muted">
            on Pro, you can start from scratch: write what you want the way you’d brief an editor (“a 15 second video of
            our smoothies being made, cut to the beat, ending on the logo”), add your clips and we plan the whole edit.
          </p>
          <ul className="flex flex-col gap-2.5">
            <Check>you get the same free storyboard first</Check>
            <Check>upload your own song and we cut to its beats</Check>
            <Check>transitions, sound effects and text, planned for you</Check>
          </ul>
        </div>
      </Section>

      <Section eyebrow="what it isn’t" title="not a template app. not fake video.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              t: "not a template",
              b: "templates make every business look the same. you pick the video that’s working right now, and we follow it with your footage.",
            },
            {
              t: "not AI-generated footage",
              b: "every frame of your video is something you filmed. we plan and edit; we never invent people, products or places.",
            },
            {
              t: "not a copy",
              b: "we take the format, not the content. the footage, the words and the business in your video are all yours.",
            },
          ].map((x) => (
            <div key={x.t} className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="font-semibold">{x.t}</h3>
              <p className="text-sm text-pretty text-muted">{x.b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="what you need" title="a phone and a few minutes.">
        <div className="grid gap-10 md:grid-cols-2">
          <ul className="flex flex-col gap-3">
            <Check>a video you’d like to remake (or, on Pro, a description of the one you want)</Check>
            <Check>a few raw clips from your phone, uploaded as they are</Check>
            <Check>your business name and the words you use, once, so we spell them right forever</Check>
          </ul>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">made for</p>
            <ul className="flex flex-wrap gap-2">
              {WHO.map((w) => (
                <li key={w} className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section eyebrow="questions" title="the details.">
        <div className="max-w-3xl">
          <Faq
            items={[
              {
                q: "how long does a video take?",
                a: "the storyboard preview takes about a minute. the finished video usually takes a few minutes, and we email you when it’s ready.",
              },
              {
                q: "what’s a “change”?",
                a: "asking for a new version: “longer first shot”, “different text”, “no slow motion”. each video comes with 3 on a plan (1 on the free video). fixing a caption word yourself never uses one.",
              },
              {
                q: "can i use the original video’s sound?",
                a: "you can keep your clips’ own sound, upload your own audio, or use the inspo’s sound if you have the rights to it.",
              },
              {
                q: "what size is the video?",
                a: "vertical 9:16, at full quality, never softer than the clips you uploaded.",
              },
            ]}
          />
        </div>
      </Section>

      <JoinSection source="what-is" />
    </MarketingShell>
  );
}
