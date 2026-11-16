"use client";

import { useEffect, useState, type RefObject } from "react";
import type { TextDefaults, TextItem, TextStyle } from "@/lib/processing/types";
import { FONT_METRICS, FRAME_H, placeItem, type Measure } from "@/lib/text-layout";
import { videoFont } from "./video-fonts";

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

/** A piece's look as the editor shows it: its own, else the video's. */
function resolved(it: TextItem, d: TextDefaults | null | undefined) {
  return { color: it.color ?? d?.color ?? "#FFFFFF", look: it.look ?? d?.look ?? "outline" };
}

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

/** What the preview needs to draw text exactly as the video will: the version's text style, size and spot. */
export type TextContext = { style?: TextStyle | null; textScale?: number | null; position?: string | null };

/** Measures text with the video's own fonts; `ready` turns true once the fonts in use have loaded. */
function useMeasure(fonts: string[]) {
  const [loaded, setLoaded] = useState(0);
  const key = [...new Set(fonts)].sort().join(",");
  useEffect(() => {
    let live = true;
    const wanted = key.split(",").filter(Boolean).map((f) => videoFont(f));
    Promise.all(wanted.map((f) => document.fonts.load(`${f.weight} 100px ${f.family}`).catch(() => [])))
      .then(() => live && setLoaded((n) => n + 1));
    return () => {
      live = false;
    };
  }, [key]);
  const [measure] = useState(() => {
    const cache = new Map<string, number>();
    let ctx: CanvasRenderingContext2D | null = null;
    const fn: Measure & { reset: () => void } = Object.assign(
      (text: string, font: string, px: number) => {
        const k = `${font}|${text}`;
        let w = cache.get(k);
        if (w === undefined) {
          ctx ??= document.createElement("canvas").getContext("2d");
          if (!ctx) return text.length * px * 0.55;
          const f = videoFont(font);
          ctx.font = `${f.weight} 100px ${f.family}`;
          w = ctx.measureText(text).width;
          cache.set(k, w);
        }
        return (w * px) / 100;
      },
      { reset: () => cache.clear() },
    );
    return fn;
  });
  // Widths measured before a font arrived were of the fallback font.
  useEffect(() => measure.reset(), [loaded, measure]);
  return { measure, ready: loaded > 0 };
}

const fu = (px: number) => `${(px / FRAME_H) * 100}cqh`; // px of the 1080×1920 frame, on the preview

/** libass's round outline (a ring of copies around the letters; a CSS stroke has sharp corners), and its drop shadow. */
function outlineShadow(width: number, color: string, shadow: boolean) {
  const ring = Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * 2 * Math.PI;
    return `${fu(Math.cos(a) * width)} ${fu(Math.sin(a) * width)} 0 ${color}`;
  });
  const inner = Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * 2 * Math.PI;
    return `${fu(Math.cos(a) * width * 0.5)} ${fu(Math.sin(a) * width * 0.5)} 0 ${color}`;
  });
  return [...inner, ...ring, ...(shadow ? [`${fu(3 + width)} ${fu(3 + width)} 0 rgba(0,0,0,0.44)`] : [])].join(", ");
}

/** The text on the video at time `t`, drawn as the finished video will draw it (font, size, wrapping, place). */
export function TextPreview({ items, t, context }: { items: TextItem[]; t: number; context?: TextContext }) {
  const showing = items.filter((it) => it.text.trim() && t >= it.start && t < it.end);
  const { measure, ready } = useMeasure(showing.map((it) => it.font ?? context?.style?.font ?? "clean_sans"));
  if (!ready) return null;
  return (
    <>
      {showing.map((it, k) => {
        const p = placeItem(it, context ?? {}, measure);
        const font = videoFont(p.look.font);
        const em = FONT_METRICS[p.look.font].em;
        const shift = p.align === "left" ? "0" : p.align === "right" ? "-100%" : "-50%";
        return (
          <div
            key={k}
            className="absolute flex flex-col whitespace-pre"
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              transform: `translate(${shift}, -50%)`,
              alignItems: p.align === "left" ? "flex-start" : p.align === "right" ? "flex-end" : "center",
              fontFamily: font.family,
              fontWeight: font.weight,
              fontSize: fu(p.size * em),
              lineHeight: fu(p.size),
              color: p.look.color,
            }}
          >
            {p.lines.map((line, j) => (
              <span
                key={j}
                style={
                  !line
                    ? undefined // a blank line: space only, nothing drawn
                    : p.look.box
                    ? // libass's box: the line's height and width, grown by the box size on every side.
                      { background: p.look.edge, boxShadow: `0 0 0 ${fu(p.look.outline)} ${p.look.edge}` }
                    : { textShadow: outlineShadow(p.look.outline, p.look.edge, p.look.shadow) }
                }
              >
                {line || "\u00a0"}
              </span>
            ))}
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
  defaults,
}: {
  items: TextItem[];
  onChange: (items: TextItem[]) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  t: number;
  duration: number;
  disabled?: boolean;
  defaults?: TextDefaults | null;
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
                      <button key={l.id} type="button" disabled={disabled} className={chip(resolved(it, defaults).look === l.id)} onClick={() => set(k, { look: l.id })}>
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
                        aria-pressed={resolved(it, defaults).color === c}
                        onClick={() => set(k, { color: c })}
                        className={`size-7 cursor-pointer rounded-full border-2 focus-visible:outline-2 focus-visible:outline-coral ${
                          resolved(it, defaults).color === c ? "border-coral" : "border-white/20"
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="any color"
                      value={resolved(it, defaults).color.toLowerCase()}
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
                      <option value="">same as the video ({FONTS.find((f) => f.id === (defaults?.font ?? "clean_sans"))?.name ?? "clean (bold)"})</option>
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
                      <option value="">same as the video ({ANIMATIONS.find((a) => a.id === (defaults?.animation ?? "none"))?.name ?? "none"})</option>
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
