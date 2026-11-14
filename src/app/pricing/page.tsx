import type { Metadata } from "next";
import { Suspense } from "react";
import { Faq, JoinSection, MAIN_CTA, MarketingShell, Section } from "@/components/marketing";
import { CHANGES_PER_VIDEO, TRIAL_CHANGES, VIDEO_LIMITS } from "@/lib/plan-format";
import { getPlans } from "@/lib/plans";
import { PricingTable } from "./pricing-table";

export const metadata: Metadata = {
  title: "pricing — viralowner",
  description: `your first video is free. Basic: ${VIDEO_LIMITS.basic} videos a month. Pro: ${VIDEO_LIMITS.pro} videos a month plus start from scratch. ${CHANGES_PER_VIDEO} changes on every video.`,
  alternates: { canonical: "/pricing" },
};

const COMPARE: { label: string; cells: [string, string, string] }[] = [
  { label: "videos", cells: ["1", `${VIDEO_LIMITS.basic} a month`, `${VIDEO_LIMITS.pro} a month`] },
  { label: "changes per video", cells: [`${TRIAL_CHANGES}`, `${CHANGES_PER_VIDEO}`, `${CHANGES_PER_VIDEO}`] },
  { label: "remake a viral video", cells: ["✓", "✓", "✓"] },
  { label: "start from scratch (describe it, we plan it)", cells: ["", "", "✓"] },
  { label: "free storyboard preview", cells: ["✓", "✓", "✓"] },
  { label: "word-by-word captions, every style", cells: ["✓", "✓", "✓"] },
  { label: "fix caption words yourself (free)", cells: ["✓", "✓", "✓"] },
  { label: "on-screen text styles", cells: ["✓", "✓", "✓"] },
  { label: "your business profile on every video", cells: ["✓", "✓", "✓"] },
  { label: "your own audio", cells: ["✓", "✓", "✓"] },
  { label: "post caption written for you", cells: ["✓", "✓", "✓"] },
  { label: "full quality download", cells: ["✓", "✓", "✓"] },
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
            try it on your own clips. if you like it, pick a plan. no contracts, cancel anytime.
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
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th scope="col" className="p-4 font-normal text-muted sm:p-5">
                  <span className="sr-only">feature</span>
                </th>
                {["Free trial", "Basic", "Pro"].map((t) => (
                  <th key={t} scope="col" className="w-[18%] p-4 text-center font-semibold sm:p-5">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.label} className="border-b border-white/[0.06] last:border-0">
                  <th scope="row" className="p-4 font-normal text-pretty sm:p-5">
                    {r.label}
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={i} className="p-4 text-center sm:p-5">
                      {c === "✓" ? (
                        <span className="text-coral" aria-label="included">
                          ✓
                        </span>
                      ) : c ? (
                        c
                      ) : (
                        <span className="text-muted/60" aria-label="not included">
                          —
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
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
