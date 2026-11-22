"use client";

import { useState } from "react";
import { TEXT_ITEMS_MAX, TEXT_MAX, type OptionTextItem } from "@/lib/video-options";
import { coveredShots, fmtS, ShotChips, shotSpans, TextLookControls, TextTimeline, type Span, type TimelineShot } from "./text-pieces";

/**
 * "Write my own", piece by piece, before the video is made: each piece of text has its own words, its
 * own time on screen (dragged on a strip of the original's shots, or certain shots only, or left to
 * us) and its own look. The times follow the shots: a shot that ends up longer stretches them with it.
 */
export function OptionTextPieces({
  items,
  onChange,
  shots,
}: {
  items: OptionTextItem[];
  onChange: (items: OptionTextItem[]) => void;
  /** The original's shots (empty when there are none to time against yet). */
  shots: TimelineShot[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  const total = shots.at(-1)?.end ?? 0;
  const used = items.reduce((n, it) => n + it.text.length, 0) + Math.max(0, items.length - 1);
  const set = (k: number, patch: Partial<OptionTextItem>) => onChange(items.map((it, j) => (j === k ? { ...it, ...patch } : it)));
  const timeIt = (k: number, a: number, b: number) =>
    set(k, { shots: null, start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100 });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        add each piece of text separately. new lines inside one piece stay together on screen.
        {shots.length > 0
          ? " drag the coral handles to set when it shows (like trimming a clip), or pick the shots it’s on. leave it and we time it like the original."
          : " we time each piece; you can drag exact times in the editor once your video is made."}
      </p>
      <ol className="flex flex-col gap-2">
        {items.map((it, k) => {
          const spans: Span[] = it.shots?.length
            ? shotSpans(shots, it.shots)
            : it.start !== null && it.start !== undefined && it.end !== null && it.end !== undefined
              ? [[it.start, it.end]]
              : [];
          const auto = spans.length === 0;
          const picked = it.shots?.length ? it.shots : coveredShots(shots, spans);
          const label = `text ${k + 1}`;
          return (
            <li key={k} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start gap-2">
                <textarea
                  aria-label={label}
                  value={it.text}
                  onChange={(e) => set(k, { text: e.target.value })}
                  rows={Math.max(1, Math.min(4, it.text.split("\n").length))}
                  maxLength={TEXT_MAX}
                  placeholder={k === 0 ? "e.g. pov: you found the best croffles in town" : "your text"}
                  className="min-h-10 flex-1 resize-y rounded-lg border border-white/15 bg-[#15151b] px-2 py-2 text-sm outline-none focus-visible:border-coral"
                />
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(null);
                      onChange(items.filter((_, j) => j !== k));
                    }}
                    aria-label={`delete ${label}`}
                    className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-coral/10 hover:text-coral focus-visible:outline-2 focus-visible:outline-coral"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                )}
              </div>
              {shots.length > 0 && (
                <>
                  <div className="mt-8">
                    <TextTimeline
                      total={total}
                      shots={shots}
                      spans={spans}
                      label={label}
                      onTapEmpty={(t) => timeIt(k, Math.max(0, Math.min(t, total - 0.5)), Math.min(total, t + 2.5))}
                      onRelease={(a, b) => timeIt(k, a, b)}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted tabular-nums">
                      {auto
                        ? "we time it (tap the strip to set it yourself)"
                        : it.shots?.length
                          ? `on ${it.shots.length === 1 ? "shot" : "shots"} ${it.shots.map((s) => s + 1).join(", ")}`
                          : `${fmtS(spans[0][0])}–${fmtS(spans[0][1])}`}
                    </span>
                    {!auto && (
                      <button
                        type="button"
                        onClick={() => set(k, { shots: null, start: null, end: null })}
                        className="ml-auto h-8 cursor-pointer rounded-full bg-white/10 px-3 font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
                      >
                        let us time it
                      </button>
                    )}
                  </div>
                  <div className="mt-2">
                    <ShotChips
                      shots={shots}
                      picked={picked}
                      allOn={picked.length === shots.length}
                      onAll={() => set(k, { shots: shots.map((_, j) => j), start: null, end: null })}
                      onToggle={(s) => {
                        const next = picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s];
                        set(k, next.length ? { shots: next.sort((a, b) => a - b), start: null, end: null } : { shots: null, start: null, end: null });
                      }}
                    />
                  </div>
                </>
              )}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(open === k ? null : k)}
                  aria-expanded={open === k}
                  className="h-8 cursor-pointer rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
                >
                  {open === k ? "done" : "style & place"}
                </button>
              </div>
              {open === k && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <TextLookControls value={it} onChange={(p) => set(k, p)} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange([...items, { text: "" }])}
          disabled={items.length >= TEXT_ITEMS_MAX || used >= TEXT_MAX}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-dashed border-white/25 px-4 text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-40"
        >
          <PlusIcon className="size-4" /> add another text
        </button>
        <span className={`text-xs tabular-nums ${used > TEXT_MAX ? "text-coral" : "text-muted"}`}>
          {used}/{TEXT_MAX}
        </span>
      </div>
    </div>
  );
}

/** "Write my own" typed before pieces existed: each line its own piece, timed by us (as it was). */
export function piecesFromText(custom: string): OptionTextItem[] {
  const lines = custom.split("\n").filter((l) => l.trim());
  return lines.length ? lines.map((text) => ({ text })) : [{ text: "" }];
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}
