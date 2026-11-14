import type { Metadata } from "next";
import { Fragment, Suspense } from "react";
import { Faq, JoinSection, MAIN_CTA, MarketingShell, Section } from "@/components/marketing";
import { CHANGES_PER_VIDEO, VIDEO_LIMITS } from "@/lib/plan-format";
import { getPlans } from "@/lib/plans";
import { PricingTable } from "./pricing-table";

export const metadata: Metadata = {
  title: "pricing — viralowner",
  description: `your first video is free. Basic: ${VIDEO_LIMITS.basic} videos a month. Pro: ${VIDEO_LIMITS.pro} videos a month plus start from scratch. ${CHANGES_PER_VIDEO} changes on every video.`,
  alternates: { canonical: "/pricing" },
};

/** Basic, Pro. `group` starts a labelled block; `sub` rows are part of the block above. */
const COMPARE: { label: string; cells: [string, string]; group?: string; sub?: boolean }[] = [
  { label: "videos a month", cells: [`${VIDEO_LIMITS.basic}`, `${VIDEO_LIMITS.pro}`] },
  { label: "changes per video", cells: [`${CHANGES_PER_VIDEO}`, `${CHANGES_PER_VIDEO}`] },
  { label: "first video free (free trial)", cells: ["✓", "✓"] },
  { label: "remake any viral video with your clips", cells: ["✓", "✓"] },
  { label: "free storyboard preview", cells: ["✓", "✓"] },
  { label: "word-by-word captions, every style", cells: ["✓", "✓"] },
  { label: "fix caption words yourself (free)", cells: ["✓", "✓"] },
  { label: "on-screen text styles", cells: ["✓", "✓"] },
  { label: "your business profile on every video", cells: ["✓", "✓"] },
  { label: "your own audio", cells: ["✓", "✓"] },
  { label: "post caption written for you", cells: ["✓", "✓"] },
  { label: "full quality download", cells: ["✓", "✓"] },
  { group: "start from scratch", label: "make your own viral video from your clips", cells: ["", "✓"] },
  { label: "no viral video needed to start", cells: ["", "✓"], sub: true },
  { label: "describe the video in your own words", cells: ["", "✓"], sub: true },
  { label: "shots, text and captions planned for you", cells: ["", "✓"], sub: true },
  { label: "transitions and sound effects picked for you", cells: ["", "✓"], sub: true },
  { label: "cut to the beat of your own song", cells: ["", "✓"], sub: true },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="px-4 pt-14 pb-6 sm:px-6 sm:pt-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
          <p className="text-sm font-medium bg-linear-to-r from-violet to-coral bg-clip-text text-transparent">pricing</p>
          <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            your first video is free.
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted">
            both plans start with a free trial: your first video is on us. no contracts, cancel anytime.
          </p>
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={<div className="h-[36rem] animate-pulse rounded-3xl bg-white/[0.03]" />}>
            <Tiers />
          </Suspense>
        </div>
      </section>

      <Section eyebrow="compare" title="what’s in each plan.">
        <div className="overflow-x-auto rounded-3xl border border-white/10">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th scope="col" className="p-4 font-normal text-muted sm:p-5">
                  <span className="sr-only">feature</span>
                </th>
                <th scope="col" className="w-[22%] p-4 text-center font-semibold sm:p-5">
                  Basic
                </th>
                <th scope="col" className="w-[22%] bg-linear-to-b from-violet/30 to-coral/10 p-4 text-center font-semibold sm:p-5">
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <Fragment key={r.label}>
                  {r.group && (
                    <tr className="border-b border-white/[0.06]">
                      <th
                        scope="rowgroup"
                        colSpan={2}
                        className="px-4 pt-6 pb-2 text-xs font-medium tracking-wide text-coral uppercase sm:px-5"
                      >
                        {r.group} · Pro only
                      </th>
                      <td className="bg-coral/[0.06]" />
                    </tr>
                  )}
                  <tr className="border-b border-white/[0.06] last:border-0">
                    <th scope="row" className={`p-4 font-normal text-pretty sm:p-5 ${r.sub ? "pl-8 text-foreground/80 sm:pl-9" : ""}`}>
                      {r.label}
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={i} className={`p-4 text-center sm:p-5 ${i === 1 ? "bg-coral/[0.06] font-medium" : ""}`}>
                        {c === "✓" ? (
                          <span className="text-base font-semibold text-emerald-400" aria-label="included">
                            ✓
                          </span>
                        ) : c ? (
                          c
                        ) : (
                          <span className="text-muted/50" aria-label="not included">
                            —
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section eyebrow="questions" title="pricing, plainly.">
        <div className="max-w-3xl">
          <Faq
            items={[
              {
                q: "what counts as a video?",
                a: "each new project you make a video for. asking for changes to it doesn’t use another video, and neither does a version that fails to make.",
              },
              {
                q: "what’s a change?",
                a: `asking for a new version of a video in plain words, like “make the hook faster”. every video on a plan includes ${CHANGES_PER_VIDEO}. fixing a caption word yourself is always free.`,
              },
              {
                q: "do unused videos roll over?",
                a: "no. your videos reset each month (yearly plans reset monthly too).",
              },
              {
                q: "why do you ask for a card for the free video?",
                a: "it keeps the free video to one per person. it’s never charged unless you choose a plan and press subscribe yourself.",
              },
              {
                q: "can i switch or cancel?",
                a: "anytime, from your dashboard. you keep your plan until the end of the period you paid for.",
              },
            ]}
          />
        </div>
      </Section>

      <JoinSection source="pricing" />
    </MarketingShell>
  );
}

async function Tiers() {
  return <PricingTable plans={await getPlans()} cta={MAIN_CTA} />;
}
