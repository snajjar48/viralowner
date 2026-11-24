"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { coveredShots, fmtS, ShotChips, shotSpans, TextLookControls, TextTimeline, type Span, type TimelineShot } from "@/components/text-pieces";
import type { TextDefaults, TextItem, TextStyle } from "@/lib/processing/types";
import { FONT_METRICS, FRAME_H, placeItem, type Measure } from "@/lib/text-layout";
import { videoFont } from "./video-fonts";

/**
 * On-screen text, edited directly: each piece of text has its own time on screen (dragged on a strip of
 * the video's shots, or certain shots only), place and look. A rough live preview shows on the video above.
 */

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

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
export function TextPreview({
  items: saved,
  t,
  context,
  show = true,
  highlight = null,
}: {
  items: TextItem[];
  t: number;
  context?: TextContext;
  show?: boolean;
  /** The text being edited (places in the list): outlined. Unchanged text is only outlined (the video already shows it). */
  highlight?: number[] | null;
}) {
  const dragged = useDragItems();
  const drawn = !!dragged || show;
  const lit = new Set(dragged ? [] : (highlight ?? []));
  const showing = (dragged ?? saved)
    .map((it, k) => ({ it, lit: lit.has(k) }))
    .filter(({ it, lit }) => it.text.trim() && t >= it.start && t < it.end && (drawn || lit));
  const { measure, ready } = useMeasure(showing.map(({ it }) => it.font ?? context?.style?.font ?? "clean_sans"));
  if (!ready) return null;
  return (
    <>
      {showing.map(({ it, lit }, k) => {
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
              color: drawn ? p.look.color : "transparent",
              ...(lit ? { outline: "2px dashed #FF6B5A", outlineOffset: fu(Math.max(6, p.size * 0.15)), borderRadius: 4 } : {}),
            }}
          >
            {p.lines.map((line, j) => (
              <span
                key={j}
                style={
                  !line || !drawn
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

/** Text items while a time handle is dragged (the preview on the video follows the finger). */
let dragItems: TextItem[] | null = null;
const dragSubs = new Set<() => void>();
function setDragItems(v: TextItem[] | null) {
  dragItems = v;
  dragSubs.forEach((f) => f());
}
function useDragItems() {
  return useSyncExternalStore(
    (f) => {
      dragSubs.add(f);
      return () => dragSubs.delete(f);
    },
    () => dragItems,
    () => null,
  );
}

/** One piece of text as the user edits it: a single item, or the copies of it on separate shots. */
type Blurb = { key: string; idx: number[] };

function blurbsOf(items: TextItem[]): Blurb[] {
  const out: Blurb[] = [];
  const byGroup = new Map<string, Blurb>();
  items.forEach((it, k) => {
    if (it.group) {
      const b = byGroup.get(it.group);
      if (b) return void b.idx.push(k);
      const nb = { key: `g-${it.group}`, idx: [k] };
      byGroup.set(it.group, nb);
      out.push(nb);
    } else out.push({ key: `i-${k}`, idx: [k] });
  });
  return out;
}

const newGroup = () => Math.random().toString(36).slice(2, 10);

export function TextItemsEditor({
  items,
  onChange,
  videoRef,
  t,
  duration,
  disabled,
  defaults,
  shots,
  onActive,
  context,
}: {
  items: TextItem[];
  onChange: (items: TextItem[]) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  t: number;
  duration: number;
  disabled?: boolean;
  defaults?: TextDefaults | null;
  /** This version's shots on its timeline (none for one-take videos). */
  shots: TimelineShot[];
  /** The text being edited (its copies' places in the list), or none. */
  onActive?: (idx: number[] | null) => void;
  /** The version's text style, so the enlarged shots draw the text as the video will. */
  context?: TextContext;
}) {
  const [open, setOpen] = useState<string | null>(null);
  /** The shot shown big under a piece of text (picked on its strip or its chips), with the text on it. */
  const [peek, setPeek] = useState<{ key: string; shot: number } | null>(null);
  const end = duration || Math.max(0, ...items.map((i) => i.end), ...shots.map((s) => s.end));
  const blurbs = blurbsOf(items);

  const seek = (s: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.min(Math.max(0, s), Math.max(0, (v.duration || s) - 0.05));
  };
  /** Every copy of this piece gets the change (its words and look). */
  const patch = (b: Blurb, p: Partial<TextItem>) => onChange(items.map((it, j) => (b.idx.includes(j) ? { ...it, ...p } : it)));
  /** This piece shown over these stretches (one copy each, linked when there are several). */
  const withSpans = (b: Blurb, spans: Span[]) => {
    const base = items[b.idx[0]];
    const group = spans.length > 1 ? (base.group ?? newGroup()) : null;
    const copies = spans.map(([a, z]) => ({ ...base, start: round2(a), end: round2(z), group }));
    const list = [...items.filter((_, j) => !b.idx.includes(j)), ...copies].sort((x, y) => x.start - y.start);
    return { list, copies };
  };
  const retime = (b: Blurb, spans: Span[]) => {
    if (!spans.length) return;
    const { list, copies } = withSpans(b, spans);
    onChange(list);
    // The one being retimed is the one being edited (its places in the list may have moved).
    const now = list.indexOf(copies[0]);
    onActive?.(blurbsOf(list).find((x) => x.idx.includes(now))?.idx ?? null);
    // Its place in the list may have changed: keep its panel open.
    if (open === b.key) {
      const at = list.indexOf(copies[0]);
      setOpen(blurbsOf(list).find((x) => x.idx.includes(at))?.key ?? null);
    }
  };

  function add() {
    const start = round1(Math.min(t, Math.max(0, end - 0.5)));
    const item: TextItem = { text: "your text", start, end: round1(Math.min(end || start + 2.5, start + 2.5)), y: 0.32, size: 1, look: "outline" };
    const next = [...items, item].sort((a, b) => a.start - b.start);
    onChange(next);
    setOpen(`i-${next.indexOf(item)}`);
    onActive?.([next.indexOf(item)]);
  }

  const small = "h-8 cursor-pointer rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        drag the coral handles to set when each text shows (like trimming a clip; they snap to the shots), drag the middle to
        move it, or pick the shots it shows on. the video jumps to where you are. the preview on the video is close; the
        finished video is exact.
      </p>
      {items.length === 0 && <p className="text-sm text-muted">no on-screen text.</p>}
      <ol className="flex flex-col gap-2">
        {blurbs.map((b, n) => {
          const first = items[b.idx[0]];
          const spans: Span[] = b.idx.map((j) => [items[j].start, items[j].end] as Span).sort((x, y) => x[0] - y[0]);
          const on = spans.some(([a, z]) => t >= a && t < z);
          const expanded = open === b.key;
          const picked = coveredShots(shots, spans);
          const label = `text ${n + 1}`;
          return (
            <li key={b.key} className={`rounded-xl border p-3 ${on ? "border-coral/50 bg-coral/[0.05]" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex items-start gap-2">
                <textarea
                  aria-label={label}
                  value={first.text}
                  disabled={disabled}
                  onChange={(e) => patch(b, { text: e.target.value })}
                  onFocus={() => {
                    seek(spans[0][0] + 0.05);
                    onActive?.(b.idx);
                  }}
                  rows={Math.min(4, first.text.split("\n").length)}
                  maxLength={300}
                  className="min-h-9 flex-1 resize-y rounded-lg border border-white/15 bg-[#15151b] px-2 py-1.5 text-sm outline-none focus-visible:border-coral"
                />
                <button
                  type="button"
                  onClick={() => {
                    setOpen(null);
                    onActive?.(null);
                    onChange(items.filter((_, j) => !b.idx.includes(j)));
                  }}
                  disabled={disabled}
                  aria-label={`delete ${label}`}
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-coral/10 hover:text-coral focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-30"
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
              <div className="mt-8">
                <TextTimeline
                  total={end}
                  shots={shots}
                  spans={spans}
                  t={t}
                  video={videoRef}
                  disabled={disabled}
                  label={label}
                  onSeek={seek}
                  onDrag={(a, z) => setDragItems(withSpans(b, [[a, z]]).list)}
                  onRelease={(a, z) => {
                    setDragItems(null);
                    retime(b, [[a, z]]);
                  }}
                  bubbleOverlay={(at) => <TextPreview items={items} t={at} context={context} highlight={b.idx} />}
                  onPickShot={(k) => {
                    setPeek({ key: b.key, shot: k });
                    onActive?.(b.idx);
                  }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="tabular-nums text-muted">
                  {spans.map(([a, z]) => `${fmtS(a)}–${fmtS(z)}`).join(", ")}
                  {spans.length > 1 && " (drag needs one stretch: tap a shot to join them)"}
                </span>
                <button
                  type="button"
                  className={`${small} ml-auto`}
                  onClick={() => {
                    seek(spans[0][0] + 0.05);
                    onActive?.(b.idx);
                  }}
                >
                  show me
                </button>
                <button
                  type="button"
                  className={small}
                  onClick={() => {
                    setOpen(expanded ? null : b.key);
                    onActive?.(expanded ? null : b.idx);
                  }}
                  aria-expanded={expanded}
                >
                  {expanded ? "done" : "style & place"}
                </button>
              </div>
              {shots.length > 1 && (
                <div className="mt-2">
                  <ShotChips
                    shots={shots}
                    picked={picked}
                    disabled={disabled}
                    allOn={spans.length === 1 && spans[0][0] <= 0.05 && spans[0][1] >= end - 0.05}
                    onAll={() => retime(b, [[0, end]])}
                    onToggle={(k) => {
                      const next = picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k];
                      if (next.length) retime(b, shotSpans(shots, next));
                      seek(shots[k].start + 0.05);
                      setPeek({ key: b.key, shot: k });
                    }}
                  />
                </div>
              )}
              {peek?.key === b.key && shots[peek.shot] && (
                <ShotPeek
                  shot={shots[peek.shot]}
                  spans={b.idx.map((j) => [items[j].start, items[j].end] as Span)}
                  items={items}
                  highlight={b.idx}
                  context={context}
                  onClose={() => setPeek(null)}
                />
              )}
              {spans.some(([a, z]) => z <= a) && <p className="mt-1 text-xs text-coral">the end needs to be after the start.</p>}
              {expanded && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <TextLookControls value={first} onChange={(p) => patch(b, p)} defaults={defaults} disabled={disabled} />
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

/** One shot, big, with the text drawn on it as the video will show it there (or a note that it isn't on it). */
function ShotPeek({
  shot,
  spans,
  items,
  highlight,
  context,
  onClose,
}: {
  shot: TimelineShot;
  spans: Span[];
  items: TextItem[];
  highlight: number[];
  context?: TextContext;
  onClose: () => void;
}) {
  // The first moment of this shot that has the text on it.
  const over = spans
    .map(([a, z]) => [Math.max(a, shot.start), Math.min(z, shot.end)] as Span)
    .filter(([a, z]) => z - a > 0.01)
    .sort((x, y) => x[0] - y[0])[0];
  const at = over ? over[0] + Math.min(0.05, (over[1] - over[0]) / 2) : shot.start + 0.05;
  return (
    <div className="mt-3 flex items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-2">
      <div className="relative aspect-[9/16] w-32 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-black sm:w-40">
        {shot.thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.thumb} alt="" className="size-full object-cover" />
        )}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 [container-type:size]">
          <TextPreview items={items} t={at} context={context} highlight={highlight} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1 text-xs">
        <p className="font-medium text-foreground">{shot.label}</p>
        <p className="text-muted">
          {over
            ? `this text shows here from ${fmtS(over[0])} to ${fmtS(over[1])}.`
            : "this text isn’t on this shot. tap it in “show on” to add it."}
        </p>
        <p className="text-muted">the picture is the clip’s cover; the video above shows the exact frame.</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-1 h-8 w-fit cursor-pointer rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
        >
          close
        </button>
      </div>
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
