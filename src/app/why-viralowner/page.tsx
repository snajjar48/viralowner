import type { Metadata } from "next";
import { JoinCta, JoinSection, MarketingShell, Section } from "@/components/marketing";

export const metadata: Metadata = {
  title: "why viralowner — posting every day without editing every night",
  description:
    "how viralowner compares to editing it yourself, hiring an editor and template apps, and what we promise about your videos.",
  alternates: { canonical: "/why-viralowner" },
};

const OPTIONS = ["editing it yourself", "hiring an editor", "template apps", "viralowner"] as const;

const ROWS: { label: string; cells: [string, string, string, string] }[] = [
  {
    label: "your time per video",
    cells: ["hours in an editing app", "briefing, waiting, reviewing", "less, but you still edit", "a few minutes of uploading"],
  },
  {
    label: "skills you need",
    cells: ["cuts, timing, captions, export settings", "none, but you manage someone", "some", "none"],
  },
  {
    label: "follows what’s working right now",
    cells: ["if you keep up", "if they keep up", "templates age fast", "you pick the video that’s working"],
  },
  {
    label: "sounds like your business",
    cells: ["yes", "once they learn it", "generic", "yes, remembered on every video"],
  },
  {
    label: "changes",
    cells: ["redo it yourself", "another round, another wait", "start over", "say it in plain words"],
  },
  {
    label: "cost",
    cells: ["your evenings", "per video or per hour", "a subscription plus your time", "first video free, then one plan"],
  },
];

const REASONS = [
  {
    t: "you choose what’s working",
    b: "trends move every week. instead of a library of templates, you bring the video that’s working right now and we follow it.",
  },
  {
    t: "right on the first try",
    b: "a free storyboard before anything is made, your business profile on every video, and your notes applied on version one, not version seven.",
  },
  {
    t: "your spin, not a template",
    b: "text and captions are written for your business and spelled your way. tell us your tone and what to never say, once.",
  },
  {
    t: "quality you’d post",
    b: "full quality export, never softer than your clips. no stretched footage, no blurry slow motion to fill time.",
  },
  {
    t: "changes without a timeline",
    b: "“make it faster.” “keep the pause.” “those two words together.” the edit changes, the timeline stays our problem.",
  },
  {
    t: "made for the apps",
    b: "vertical, captioned word by word, with every word kept clear of TikTok’s and Reels’ buttons, plus a caption for the post.",
  },
];

const PROMISES = [
  { t: "we never invent footage", b: "every frame is something you filmed." },
  { t: "we never make your clips look worse", b: "what you upload is the floor for quality, not the ceiling." },
  { t: "you have the last word", b: "if you ask for it, it changes, even if it’s different from the original video." },
];

export default function WhyPage() {
  return (
    <MarketingShell>
      <section className="px-4 pt-14 pb-10 sm:px-6 sm:pt-24">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <p className="text-sm font-medium bg-linear-to-r from-violet to-coral bg-clip-text text-transparent">why viralowner</p>
          <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            posting every day shouldn’t mean editing every night.
          </h1>
          <p className="text-lg text-pretty text-muted sm:text-xl">
            the videos that work follow a format. learning it, filming for it and editing to it takes hours you could
            spend running your business. we take the editing off your plate and keep the part only you can do: your
            spin on it.
          </p>
          <JoinCta id="hero" source="why-hero" />
        </div>
      </section>

      <Section eyebrow="the options" title="how it compares.">
        {/* Phones: one card per option. */}
        <div className="grid gap-4 md:hidden">
          {OPTIONS.map((o, c) => (
            <div
              key={o}
              className={`rounded-3xl border p-5 ${c === 3 ? "border-coral/40 bg-linear-to-br from-violet/20 to-coral/10" : "border-white/10 bg-white/[0.03]"}`}
            >
              <h3 className="mb-3 font-semibold">{o}</h3>
              <dl className="grid grid-cols-1 gap-2 text-sm">
                {ROWS.map((r) => (
                  <div key={r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3">
                    <dt className="text-muted">{r.label}</dt>
                    <dd>{r.cells[c]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        {/* Wider screens: a table. */}
        <div className="hidden overflow-hidden rounded-3xl border border-white/10 md:block">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th scope="col" className="w-[19%] p-5 font-normal text-muted">
                  <span className="sr-only">compare</span>
                </th>
                {OPTIONS.map((o, c) => (
                  <th
                    key={o}
                    scope="col"
                    className={`p-5 font-semibold ${c === 3 ? "bg-linear-to-b from-violet/25 to-coral/10 text-foreground" : ""}`}
                  >
                    {o}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label} className="border-b border-white/[0.06] last:border-0">
                  <th scope="row" className="p-5 font-normal text-muted">
                    {r.label}
                  </th>
                  {r.cells.map((cell, c) => (
                    <td key={c} className={`p-5 text-pretty ${c === 3 ? "bg-coral/[0.06] font-medium" : "text-foreground/80"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section eyebrow="what makes it different" title="built around one idea: right the first time.">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map((r) => (
            <li key={r.t} className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="font-semibold">{r.t}</h3>
              <p className="text-sm text-pretty text-muted">{r.b}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section eyebrow="our promises" title="three things we won’t do.">
        <ul className="grid gap-6 md:grid-cols-3">
          {PROMISES.map((p, i) => (
            <li key={p.t} className="flex flex-col gap-2">
              <span className="text-5xl font-semibold bg-linear-to-br from-violet to-coral bg-clip-text text-transparent">
                {i + 1}
              </span>
              <h3 className="text-lg font-semibold">{p.t}</h3>
              <p className="text-pretty text-muted">{p.b}</p>
            </li>
          ))}
        </ul>
      </Section>

      <JoinSection source="why" title="spend the hours on your business instead." />
    </MarketingShell>
  );
}
