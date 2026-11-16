"use client";

import { useEffect, useState, type RefObject } from "react";
import type { TextItem } from "@/lib/processing/types";

/**
 * On-screen text, edited directly: each piece of text has its own time on screen (any moment, over
 * any number of shots), place and look. A rough live preview shows on the video above.
 */

const FONTS: { id: string; name: string; css: string }[] = [
  { id: "clean_sans", name: "clean (bold)", css: "Montserrat, system-ui, sans-serif" },
  { id: "semibold_sans", name: "classic", css: "Montserrat, system-ui, sans-serif" },
  { id: "heavy_sans", name: "heavy", css: "'Archivo Black', Impact, sans-serif" },
  { id: "condensed", name: "condensed", css: "Anton, Impact, 'Arial Narrow Bold', sans-serif" },
  { id: "tall_caps", name: "tall caps", css: "'Bebas Neue', Impact, sans-serif" },
  { id: "serif", name: "serif", css: "'DM Serif Display', Georgia, serif" },
  { id: "typewriter", name: "typewriter", css: "'Courier Prime', 'Courier New', monospace" },
  { id: "marker", name: "marker", css: "'Permanent Marker', 'Marker Felt', cursive" },
  { id: "script", name: "script", css: "Pacifico, 'Brush Script MT', cursive" },
  { id: "rounded", name: "rounded", css: "'Lilita One', ui-rounded, 'Arial Rounded MT Bold', sans-serif" },
];
const COLORS = ["#FFFFFF", "#000000", "#FFD84D", "#FF6B5A", "#FF5FD2", "#4DA3FF", "#3DDC84"];
const ANIMATIONS = [
  { id: "none", name: "none" },
  { id: "pop", name: "pop in" },
  { id: "fade", name: "fade" },
  { id: "slide_up", name: "slide up" },
  { id: "typewriter", name: "typewriter" },
  { id: "word_by_word", name: "word by word" },
];
const LOOKS = [
  { id: "outline", name: "outline" },
  { id: "box", name: "box" },
  { id: "plain", name: "plain" },
] as const;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The video's playhead, updated while it plays or seeks. */
export function usePlayhead(videoRef: RefObject<HTMLVideoElement | null>) {
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tick = () => {
      setT(v.currentTime);
      if (Number.isFinite(v.duration)) setDuration(v.duration);
    };
    tick();
    v.addEventListener("timeupdate", tick);
    v.addEventListener("seeked", tick);
    v.addEventListener("loadedmetadata", tick);
    return () => {
      v.removeEventListener("timeupdate", tick);
      v.removeEventListener("seeked", tick);
      v.removeEventListener("loadedmetadata", tick);
    };
  }, [videoRef]);
  return { t, duration };
}

/** A rough preview of the text on the video at time `t` (the finished video is drawn exactly). */
export function TextPreview({ items, t }: { items: TextItem[]; t: number }) {
  return (
    <>
      {items
        .filter((it) => t >= it.start && t < it.end)
        .map((it, k) => {
          const align = it.align ?? "center";
          const look = it.look ?? "outline";
          const color = it.color ?? "#FFFFFF";
          const dark = color === "#000000";
          return (
            <div
              key={k}
              className="absolute w-full px-[7%] leading-tight font-bold whitespace-pre-line"
              style={{
                top: `${(it.y ?? 0.32) * 100}%`,
                transform: "translateY(-50%)",
                textAlign: align,
                fontSize: `${4.6 * (it.size ?? 1)}cqh`,
                fontFamily: FONTS.find((f) => f.id === it.font)?.css ?? FONTS[0].css,
                color,
              }}
            >
              <span
                className={look === "box" ? "rounded-[0.15em] px-[0.25em] py-[0.05em] [box-decoration-break:clone]" : ""}
                style={
                  look === "box"
                    ? { background: dark ? "#FFFFFF" : "#000000" }
                    : look === "outline"
                      ? { WebkitTextStroke: `0.12em ${dark ? "#FFFFFF" : "#000000"}`, paintOrder: "stroke fill" }
                      : { textShadow: "0 0.05em 0.2em rgba(0,0,0,0.7)" }
                }
              >
                {it.text}
              </span>
            </div>
          );
        })}
    </>
  );
}

export function TextItemsEditor({
  items,
  onChange,
  videoRef,
  t,
  duration,
  disabled,
}: {
  items: TextItem[];
  onChange: (items: TextItem[]) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  t: number;
  duration: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const end = duration || Math.max(0, ...items.map((i) => i.end));

  const set = (k: number, patch: Partial<TextItem>) => onChange(items.map((it, j) => (j === k ? { ...it, ...patch } : it)));
  const seek = (s: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.min(Math.max(0, s), Math.max(0, (v.duration || s) - 0.05));
  };

  function add() {
    const start = round1(Math.min(t, Math.max(0, end - 0.5)));
    const item: TextItem = { text: "your text", start, end: round1(Math.min(end || start + 2.5, start + 2.5)), y: 0.32, size: 1, look: "outline" };
    const next = [...items, item].sort((a, b) => a.start - b.start);
    onChange(next);
    setOpen(next.indexOf(item));
  }

  const chip = (on: boolean) =>
    `h-8 cursor-pointer rounded-full px-3 text-xs transition focus-visible:outline-2 focus-visible:outline-coral ${
      on ? "bg-linear-to-r from-violet to-coral font-medium text-white" : "border border-white/15 text-muted hover:text-foreground"
    }`;
  const small = "h-8 cursor-pointer rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral";
  const field = "h-9 w-20 rounded-lg border border-white/15 bg-[#15151b] px-2 text-sm tabular-nums outline-none focus-visible:border-coral";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        each text shows from its start to its end, whatever the shots. play or scrub the video above and tap “now” to set a time.
        the preview on the video is close; the finished video is exact.
      </p>
      {items.length === 0 && <p className="text-sm text-muted">no on-screen text.</p>}
      <ol className="flex flex-col gap-2">
        {items.map((it, k) => {
          const on = t >= it.start && t < it.end;
          const expanded = open === k;
          return (
            <li key={k} className={`rounded-xl border p-3 ${on ? "border-coral/50 bg-coral/[0.05]" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex items-start gap-2">
                <textarea
                  aria-label={`text ${k + 1}`}
                  value={it.text}
                  disabled={disabled}
                  onChange={(e) => set(k, { text: e.target.value })}
                  onFocus={() => seek(it.start + 0.05)}
                  rows={Math.min(4, it.text.split("\n").length)}
                  maxLength={300}
                  className="min-h-9 flex-1 resize-y rounded-lg border border-white/15 bg-[#15151b] px-2 py-1.5 text-sm outline-none focus-visible:border-coral"
                />
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, j) => j !== k))}
                  disabled={disabled}
                  aria-label={`delete text ${k + 1}`}
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-coral/10 hover:text-coral focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-30"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5 text-muted">
                  from
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={it.start}
                    disabled={disabled}
                    onChange={(e) => set(k, { start: round1(Math.max(0, Number(e.target.value))) })}
                    className={field}
                  />
                </label>
                <button type="button" className={small} disabled={disabled} onClick={() => set(k, { start: round1(t) })}>
                  now
                </button>
                <label className="flex items-center gap-1.5 text-muted">
                  to
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={it.end}
                    disabled={disabled}
                    onChange={(e) => set(k, { end: round1(Math.max(0, Number(e.target.value))) })}
                    className={field}
                  />
                </label>
                <button type="button" className={small} disabled={disabled} onClick={() => set(k, { end: round1(t) })}>
                  now
                </button>
                <button type="button" className={small} onClick={() => seek(it.start + 0.05)}>
                  show me
                </button>
                <button type="button" className={`${small} ml-auto`} onClick={() => setOpen(expanded ? null : k)} aria-expanded={expanded}>
                  {expanded ? "done" : "style & place"}
                </button>
              </div>
              {it.end <= it.start && <p className="mt-1 text-xs text-coral">the end needs to be after the start.</p>}
              {expanded && (
                <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted">
                      height on screen ({Math.round((it.y ?? 0.32) * 100)}% from the top · tiktok’s buttons cover the top 12% and bottom 25%)
                    </span>
                    <input
                      type="range"
                      min={0.05}
                      max={0.95}
                      step={0.01}
                      value={it.y ?? 0.32}
                      disabled={disabled}
                      onChange={(e) => set(k, { y: Number(e.target.value) })}
                      className="accent-coral"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted">size ({Math.round((it.size ?? 1) * 100)}%)</span>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={it.size ?? 1}
                      disabled={disabled}
                      onChange={(e) => set(k, { size: Number(e.target.value) })}
                      className="accent-coral"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-14 text-muted">align</span>
                    {(["left", "center", "right"] as const).map((a) => (
                      <button key={a} type="button" disabled={disabled} className={chip((it.align ?? "center") === a)} onClick={() => set(k, { align: a, x: null })}>
                        {a}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-14 text-muted">look</span>
                    {LOOKS.map((l) => (
                      <button key={l.id} type="button" disabled={disabled} className={chip((it.look ?? "outline") === l.id)} onClick={() => set(k, { look: l.id })}>
                        {l.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-14 text-muted">color</span>
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={disabled}
                        aria-label={`color ${c}`}
                        aria-pressed={(it.color ?? "#FFFFFF") === c}
                        onClick={() => set(k, { color: c })}
                        className={`size-7 cursor-pointer rounded-full border-2 focus-visible:outline-2 focus-visible:outline-coral ${
                          (it.color ?? "#FFFFFF") === c ? "border-coral" : "border-white/20"
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="any color"
                      value={(it.color ?? "#FFFFFF").toLowerCase()}
                      disabled={disabled}
                      onChange={(e) => set(k, { color: e.target.value.toUpperCase() })}
                      className="size-7 cursor-pointer rounded-full border border-white/20 bg-transparent"
                    />
                  </div>
                  <label className="flex items-center gap-2">
                    <span className="w-14 text-muted">font</span>
                    <select
                      value={it.font ?? ""}
                      disabled={disabled}
                      onChange={(e) => set(k, { font: e.target.value || null })}
                      className="h-9 rounded-lg border border-white/15 bg-[#15151b] px-2 text-sm outline-none focus-visible:border-coral"
                    >
                      <option value="">same as the video</option>
                      {FONTS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-14 text-muted">animation</span>
                    <select
                      value={it.animation ?? ""}
                      disabled={disabled}
                      onChange={(e) => set(k, { animation: e.target.value || null })}
                      className="h-9 rounded-lg border border-white/15 bg-[#15151b] px-2 text-sm outline-none focus-visible:border-coral"
                    >
                      <option value="">same as the video</option>
                      {ANIMATIONS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={add}
        disabled={disabled || items.length >= 40}
        className="flex h-10 w-fit cursor-pointer items-center gap-2 rounded-full border border-dashed border-white/25 px-4 text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-40"
      >
        <PlusIcon className="size-4" /> add text at {round1(t)}s
      </button>
    </div>
  );
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
