"use client";

import { useState } from "react";
import type { TextItem } from "@/lib/processing/types";
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
  length = null,
  planHint = false,
  fromScratch = false,
}: {
  /** "Start from scratch": the shots are the previewed plan's (there's no original). */
  fromScratch?: boolean;
  /** "Start from scratch" with no preview yet: say the preview puts the shots on the strip. */
  planHint?: boolean;
  items: OptionTextItem[];
  onChange: (items: OptionTextItem[]) => void;
  /** The original's shots (empty when there are none to time against). */
  shots: TimelineShot[];
  /** "Start from scratch": the length picked for the video (times are seconds of it); null: not picked. */
  length?: number | null;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const total = shots.at(-1)?.end ?? length ?? 0;
  const timed = total > 0;
  const filled = items.filter((it) => it.text.trim());
  const used = filled.reduce((n, it) => n + it.text.length, 0) + Math.max(0, filled.length - 1);
  const blanks = items.filter((it) => !it.text.trim() && it.hint).length;
  const set = (k: number, patch: Partial<OptionTextItem>) => onChange(items.map((it, j) => (j === k ? { ...it, ...patch } : it)));
  const timeIt = (k: number, a: number, b: number) =>
    set(k, { shots: null, start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100 });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        add each piece of text separately. new lines inside one piece stay together on screen.
        {shots.length > 0
          ? fromScratch
            ? " drag the coral handles to set when it shows (like trimming a clip), or pick the shots from your preview it’s on. leave it and we time it."
            : " drag the coral handles to set when it shows (like trimming a clip), or pick the shots it’s on. leave it and we time it like the original."
          : timed
            ? " drag the coral handles to set when it shows in your video (like trimming a clip). leave it and we time it."
            : " we time each piece. to set exact times, pick a length for your video above (or drag them in the editor once it’s made)."}
        {planHint && " tip: tap “preview the plan first” (free) and your shots show up here, so you can see exactly where each text goes."}
      </p>
      {items.some((it) => it.hint) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-muted">
          <span>
            the grey words show what {fromScratch ? "our plan has" : "the original has"} there. type over them; a box left
            blank stays out of your video.
          </span>
          {blanks > 1 && (
            <button
              type="button"
              onClick={() => onChange(items.map((it) => (!it.text.trim() && it.hint ? { ...it, text: it.hint } : it)))}
              className="h-8 cursor-pointer rounded-full bg-white/10 px-3 font-medium text-foreground hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
            >
              fill in all {blanks} as shown
            </button>
          )}
        </div>
      )}
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
                  rows={Math.max(1, Math.min(4, (it.text || it.hint || "").split("\n").length))}
                  maxLength={TEXT_MAX}
                  placeholder={it.hint || (k === 0 ? "e.g. pov: you found the best croffles in town" : "your text")}
                  className="min-h-10 flex-1 resize-y rounded-lg border border-white/15 bg-[#15151b] px-2 py-2 text-sm outline-none placeholder:text-white/30 focus-visible:border-coral"
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
              {!it.text.trim() && it.hint && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>left blank: it won’t be in your video.</span>
                  <button
                    type="button"
                    onClick={() => set(k, { text: it.hint })}
                    className="cursor-pointer underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
                  >
                    use the grey words
                  </button>
                </div>
              )}
              {timed && (
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

/**
 * The text a free preview planned, as pieces to edit before the video is made: each with its time
 * (and, when it's drawn as separate pieces, its place and look). The grey hint is the planned words.
 * `originalShots`: a remake's original shots (times go back onto the original's timeline, which is
 * what pieces are timed on); none for "start from scratch" (times are the preview's own).
 */
export function piecesFromPreview(
  frames: { durationS: number; text: string }[],
  textItems: TextItem[] | null | undefined,
  originalShots?: TimelineShot[],
): OptionTextItem[] {
  if (originalShots && originalShots.length !== frames.length) return [];
  const starts = frames.map((_, i) => frames.slice(0, i).reduce((n, f) => n + f.durationS, 0));
  const total = frames.reduce((n, f) => n + f.durationS, 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  /** A moment of the planned video on the original's timeline (same shot, same part of it). */
  const back = (t: number, end: boolean) => {
    if (!originalShots) return r2(t);
    let i = frames.findIndex((f, j) => (end ? t > starts[j] + 1e-6 && t <= starts[j] + f.durationS + 1e-6 : t < starts[j] + f.durationS - 1e-6));
    if (i < 0) i = frames.length - 1;
    const frac = frames[i].durationS > 0 ? Math.min(1, Math.max(0, (t - starts[i]) / frames[i].durationS)) : 0;
    const o = originalShots[i];
    return r2(o.start + frac * (o.end - o.start));
  };
  if (textItems) {
    const pieces = textItems
      .filter((x) => x.text.trim() && x.end > x.start)
      .slice(0, TEXT_ITEMS_MAX)
      .map((x) => ({
        text: x.text,
        hint: x.text,
        start: back(Math.max(0, x.start), false),
        end: back(Math.min(total, x.end), true),
        ...(typeof x.y === "number" ? { y: x.y } : {}),
        ...(typeof x.x === "number" ? { x: x.x } : {}),
        ...(x.align ? { align: x.align } : {}),
        ...(typeof x.size === "number" && Math.abs(x.size - 1) > 0.01 ? { size: x.size } : {}),
        ...(x.color ? { color: x.color } : {}),
        ...(x.font ? { font: x.font } : {}),
        ...(x.look ? { look: x.look } : {}),
        ...(x.animation ? { animation: x.animation } : {}),
      }));
    // Top to bottom when every piece has its own place; otherwise in time order.
    if (pieces.every((x) => typeof x.y === "number")) pieces.sort((a, b) => a.y! - b.y! || a.start - b.start);
    return pieces;
  }
  // Each shot's text over its shot: one piece for each run of shots with the same words.
  const out: OptionTextItem[] = [];
  frames.forEach((f, i) => {
    const text = f.text.trim();
    if (!text) return;
    const last = out.at(-1);
    if (last && last.text === text && (originalShots ? last.shots?.at(-1) === i - 1 : last.end === r2(starts[i]))) {
      if (originalShots) last.shots!.push(i);
      else last.end = r2(starts[i] + f.durationS);
      return;
    }
    out.push(
      originalShots
        ? { text, hint: text, shots: [i] }
        : { text, hint: text, start: r2(starts[i]), end: r2(starts[i] + f.durationS) },
    );
  });
  return out.slice(0, TEXT_ITEMS_MAX);
}
