"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import type { TextLook } from "@/lib/video-options";

/**
 * The parts of editing one piece of on-screen text that the options step and the editor share: when it
 * shows (a strip of the video's shots with two handles, like trimming a clip, plus "only on these
 * shots"), and how it looks and where it sits.
 */

export const TEXT_FONT_CHOICES: { id: string; name: string }[] = [
  { id: "clean_sans", name: "clean (bold)" },
  { id: "social_sans", name: "social" },
  { id: "semibold_sans", name: "classic" },
  { id: "heavy_sans", name: "heavy" },
  { id: "condensed", name: "condensed" },
  { id: "tall_caps", name: "tall caps" },
  { id: "serif", name: "serif" },
  { id: "typewriter", name: "typewriter" },
  { id: "marker", name: "marker" },
  { id: "script", name: "script" },
  { id: "rounded", name: "rounded" },
];
const COLORS = ["#FFFFFF", "#000000", "#FFD84D", "#FF6B5A", "#FF5FD2", "#4DA3FF", "#3DDC84"];
export const TEXT_ANIMATION_CHOICES = [
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

/** What a piece uses when it has no look of its own ("same as the video"). */
export interface LookDefaults {
  font?: string;
  color?: string;
  look?: "outline" | "box" | "plain";
  animation?: string;
}

export const chipClass = (on: boolean) =>
  `h-8 cursor-pointer rounded-full px-3 text-xs transition focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-40 ${
    on ? "bg-linear-to-r from-violet to-coral font-medium text-white" : "border border-white/15 text-muted hover:text-foreground"
  }`;
const selectClass = "h-9 rounded-lg border border-white/15 bg-[#15151b] px-2 text-sm outline-none focus-visible:border-coral";

/** Height, size, alignment, look, color, font and animation of one piece of text. */
export function TextLookControls({
  value,
  onChange,
  defaults,
  disabled,
}: {
  value: TextLook;
  onChange: (patch: Partial<TextLook>) => void;
  defaults?: LookDefaults | null;
  disabled?: boolean;
}) {
  const color = value.color ?? defaults?.color ?? "#FFFFFF";
  const look = value.look ?? defaults?.look ?? "outline";
  const placed = value.y !== null && value.y !== undefined;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2 text-muted">
          <span>
            height on screen{" "}
            {placed ? `(${Math.round((value.y ?? 0.32) * 100)}% from the top)` : "(where the video puts it)"}
          </span>
          {placed && (
            <button type="button" disabled={disabled} onClick={() => onChange({ y: null })} className="cursor-pointer underline underline-offset-2">
              reset
            </button>
          )}
        </span>
        <input
          type="range"
          min={0.05}
          max={0.95}
          step={0.01}
          value={value.y ?? 0.32}
          disabled={disabled}
          aria-label="height on screen"
          onChange={(e) => onChange({ y: Number(e.target.value) })}
          className={`accent-coral ${placed ? "" : "opacity-50"}`}
        />
        <span className="text-[11px] text-muted">tiktok’s buttons cover the top 12% and the bottom 25%.</span>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-muted">size ({Math.round((value.size ?? 1) * 100)}%)</span>
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={value.size ?? 1}
          disabled={disabled}
          onChange={(e) => onChange({ size: Number(e.target.value) })}
          className="accent-coral"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-muted">align</span>
        {(["left", "center", "right"] as const).map((a) => (
          <button key={a} type="button" disabled={disabled} className={chipClass((value.align ?? "center") === a)} onClick={() => onChange({ align: a, x: null })}>
            {a}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-muted">look</span>
        {LOOKS.map((l) => (
          <button key={l.id} type="button" disabled={disabled} className={chipClass(look === l.id)} onClick={() => onChange({ look: l.id })}>
            {l.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 text-muted">color</span>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-label={`color ${c}`}
            aria-pressed={color === c}
            onClick={() => onChange({ color: c })}
            className={`size-7 cursor-pointer rounded-full border-2 focus-visible:outline-2 focus-visible:outline-coral ${color === c ? "border-coral" : "border-white/20"}`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          aria-label="any color"
          value={color.toLowerCase()}
          disabled={disabled}
          onChange={(e) => onChange({ color: e.target.value.toUpperCase() })}
          className="size-7 cursor-pointer rounded-full border border-white/20 bg-transparent"
        />
      </div>
      <label className="flex items-center gap-2">
        <span className="w-16 text-muted">font</span>
        <select value={value.font ?? ""} disabled={disabled} onChange={(e) => onChange({ font: e.target.value || null })} className={selectClass}>
          <option value="">
            same as the video{defaults?.font ? ` (${TEXT_FONT_CHOICES.find((f) => f.id === defaults.font)?.name ?? "clean (bold)"})` : ""}
          </option>
          {TEXT_FONT_CHOICES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-16 text-muted">animation</span>
        <select value={value.animation ?? ""} disabled={disabled} onChange={(e) => onChange({ animation: e.target.value || null })} className={selectClass}>
          <option value="">
            same as the video{defaults?.animation ? ` (${TEXT_ANIMATION_CHOICES.find((a) => a.id === defaults.animation)?.name ?? "none"})` : ""}
          </option>
          {TEXT_ANIMATION_CHOICES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ---- When a piece shows

/** One shot on the video's timeline (seconds). */
export interface TimelineShot {
  start: number;
  end: number;
  /** "shot 2". */
  label: string;
  thumb?: string | null;
}

/** Shots from their lengths, one after another. */
export function timelineShots(list: { durationS: number; label: string; thumb?: string | null }[]): TimelineShot[] {
  let t = 0;
  return list.map((s) => {
    const start = t;
    t += Math.max(0, s.durationS);
    return { start, end: t, label: s.label, thumb: s.thumb ?? null };
  });
}

export type Span = [number, number];

/** The given shots as time spans (neighbors joined). */
export function shotSpans(shots: TimelineShot[], picked: number[]): Span[] {
  const out: Span[] = [];
  for (const k of [...new Set(picked)].sort((a, b) => a - b)) {
    const s = shots[k];
    if (!s) continue;
    const last = out.at(-1);
    if (last && Math.abs(last[1] - s.start) < 0.02) last[1] = s.end;
    else out.push([s.start, s.end]);
  }
  return out;
}

/** The shots mostly covered by these spans (more than half of the shot, or most of a short piece). */
export function coveredShots(shots: TimelineShot[], spans: Span[]): number[] {
  return shots.flatMap((s, k) => {
    const len = s.end - s.start;
    if (len <= 0) return [];
    const over = spans.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, s.end) - Math.max(a, s.start)), 0);
    return over / len > 0.5 ? [k] : [];
  });
}

export const fmtS = (s: number) => `${(Math.round(s * 10) / 10).toFixed(1)}s`;
const MIN_S = 0.3;

/**
 * The video's shots as a strip, with this piece's time on screen framed in coral. One stretch has two
 * handles (drag them like trimming a clip, or drag the middle to move it); several stretches (certain
 * shots only) are shown as they are. Handles snap to the shots' edges.
 */
export function TextTimeline({
  total,
  shots,
  spans,
  onDrag,
  onRelease,
  onSeek,
  onTapEmpty,
  t,
  video,
  disabled,
  label,
  bubbleOverlay,
  onPickShot,
}: {
  total: number;
  shots: TimelineShot[];
  /** Empty: no times set (the video times it). */
  spans: Span[];
  /** Each step of a drag (for a live preview). The strip shows the drag itself either way. */
  onDrag?: (a: number, b: number) => void;
  /** The drag is over: keep these times. */
  onRelease: (a: number, b: number) => void;
  /** Show this moment of the video (the editor's player). */
  onSeek?: (t: number) => void;
  /** A tap on the strip with no times set yet (the options step starts a stretch there). */
  onTapEmpty?: (t: number) => void;
  /** The playhead. */
  t?: number | null;
  /** The player, to show its frame above the finger while dragging. */
  video?: RefObject<HTMLVideoElement | null>;
  disabled?: boolean;
  label: string;
  /** Drawn over the frame above the finger while dragging (e.g. the text as it will look at that moment). */
  bubbleOverlay?: (t: number) => ReactNode;
  /** A shot on the strip was tapped. */
  onPickShot?: (k: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "start" | "end" | "body"; grab: number; a: number; b: number } | null>(null);
  const latestX = useRef(0);
  const frame = useRef(0);
  const [draft, setDraft] = useState<Span | null>(null);
  const [dragging, setDragging] = useState<"start" | "end" | "body" | null>(null);
  const draftRef = useRef<Span | null>(null);
  const bubble = useRef<HTMLCanvasElement | null>(null);
  const dur = Math.max(total, 0.1);
  const one = spans.length === 1 ? (draft ?? spans[0]) : null;
  const shown: Span[] = one ? [one] : spans;
  const at = (x: number) => Math.min(Math.max(x, 0), dur) / dur;
  const inset = (x: number) => `calc(0.875rem + (100% - 1.75rem) * ${at(x)})`;

  function timeAt(clientX: number) {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur));
  }

  /** To a shot's edge when within a few pixels of one, else to 0.05s. */
  function snap(x: number) {
    const w = track.current?.getBoundingClientRect().width ?? 300;
    const near = (10 / Math.max(w, 1)) * dur;
    const edges = [0, dur, ...shots.flatMap((s) => [s.start, s.end])];
    const edge = edges.reduce((best, e) => (Math.abs(e - x) < Math.abs(best - x) ? e : best), Infinity);
    if (Math.abs(edge - x) <= near) return Math.round(edge * 100) / 100;
    return Math.round(x * 20) / 20;
  }

  function drawBubble() {
    const c = bubble.current;
    const v = video?.current;
    if (!c || !v || v.readyState < 2) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const vw = v.videoWidth || 9;
    const vh = v.videoHeight || 16;
    const scale = Math.max(c.width / vw, c.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    try {
      ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
    } catch {
      // Not drawable yet.
    }
  }

  useEffect(() => {
    const v = video?.current;
    if (!v || !draft) return;
    v.addEventListener("seeked", drawBubble);
    return () => v.removeEventListener("seeked", drawBubble);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, draft !== null]);

  function set(span: Span) {
    draftRef.current = span;
    setDraft(span);
    onDrag?.(span[0], span[1]);
  }

  function apply() {
    frame.current = 0;
    const d = drag.current;
    if (!d) return;
    const x = timeAt(latestX.current) + d.grab;
    if (d.kind === "start") {
      const a = Math.max(0, Math.min(snap(x), d.b - MIN_S));
      set([a, d.b]);
      onSeek?.(a + 0.02);
    } else if (d.kind === "end") {
      const b = Math.min(dur, Math.max(snap(x), d.a + MIN_S));
      set([d.a, b]);
      onSeek?.(Math.max(d.a, b - 0.05));
    } else {
      const len = d.b - d.a;
      const a = Math.min(Math.max(0, snap(x)), dur - len);
      set([a, a + len]);
      onSeek?.(a + 0.02);
    }
  }

  function onDown(e: ReactPointerEvent<HTMLElement>) {
    if (disabled) return;
    const kind = e.currentTarget.dataset.part as "start" | "end" | "body" | "track";
    const x = timeAt(e.clientX);
    if (kind === "track") {
      if (!spans.length && onTapEmpty) onTapEmpty(snap(x));
      else onSeek?.(x);
      const k = shots.findIndex((s) => x >= s.start && x < s.end);
      if (k >= 0) onPickShot?.(k);
      return;
    }
    if (!one) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [a, b] = one;
    drag.current = { kind, grab: kind === "start" ? a - x : kind === "end" ? b - x : a - x, a, b };
    setDragging(kind);
    latestX.current = e.clientX;
    set([a, b]);
    onSeek?.(kind === "end" ? Math.max(a, b - 0.05) : a + 0.02);
  }

  function onMove(e: ReactPointerEvent<HTMLElement>) {
    if (!drag.current) return;
    latestX.current = e.clientX;
    if (!frame.current) frame.current = requestAnimationFrame(apply);
  }

  function up() {
    if (!drag.current) return;
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      apply();
    }
    drag.current = null;
    setDragging(null);
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (d) onRelease(d[0], d[1]);
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function key(kind: "start" | "end") {
    return (e: KeyboardEvent) => {
      if (!one || disabled) return;
      const step = e.shiftKey ? 1 : 0.1;
      const [a, b] = one;
      let next: Span | null = null;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = kind === "start" ? [Math.max(0, a - step), b] : [a, Math.max(a + MIN_S, b - step)];
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = kind === "start" ? [Math.min(b - MIN_S, a + step), b] : [a, Math.min(dur, b + step)];
      if (!next) return;
      e.preventDefault();
      const r: Span = [Math.round(next[0] * 100) / 100, Math.round(next[1] * 100) / 100];
      onSeek?.(kind === "start" ? r[0] + 0.02 : Math.max(r[0], r[1] - 0.05));
      onRelease(r[0], r[1]);
    };
  }

  const point = dragging === "end" && one ? one[1] : one ? one[0] : 0;
  const pointShot = shots.findIndex((s) => point >= s.start - 0.01 && point < s.end - 0.01);

  return (
    <div className={`relative h-12 touch-none select-none px-3.5 ${disabled ? "opacity-60" : ""}`}>
      {draft && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full z-30 mb-2 flex -translate-x-1/2 flex-col items-center gap-1"
          style={{ left: `clamp(3.5rem, ${inset(point)}, calc(100% - 3.5rem))` }}
        >
          {video && (
            <div className="relative h-48 w-[6.75rem] overflow-hidden rounded-lg border-2 border-white bg-black shadow-[0_4px_16px_rgba(0,0,0,0.6)]">
              <canvas
                ref={(el) => {
                  bubble.current = el;
                  drawBubble();
                }}
                width={216}
                height={384}
                className="size-full"
              />
              {bubbleOverlay && <div className="absolute inset-0 [container-type:size]">{bubbleOverlay(point)}</div>}
            </div>
          )}
          <span className="whitespace-nowrap rounded-full bg-black/85 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {fmtS(point)}
            {pointShot >= 0 ? ` · ${shots[pointShot].label}` : ""}
          </span>
        </div>
      )}
      <div
        ref={track}
        data-part="track"
        onPointerDown={onDown}
        className={`relative size-full overflow-hidden rounded-md bg-white/5 ${disabled ? "" : "cursor-pointer"}`}
      >
        {shots.map((s, k) => (
          <span
            key={k}
            className="absolute inset-y-0 overflow-hidden border-r-2 border-black/70 bg-white/10"
            style={{ left: `${at(s.start) * 100}%`, width: `${(at(s.end) - at(s.start)) * 100}%` }}
          >
            {s.thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.thumb} alt="" draggable={false} className="size-full object-cover opacity-80" />
            )}
            <span className="absolute bottom-0.5 left-1 rounded bg-black/70 px-1 text-[10px] leading-4 text-white">{k + 1}</span>
          </span>
        ))}
        {/* No shots to show (yet): seconds marked along the strip instead. */}
        {shots.length === 0 &&
          ticks(dur).map((x) => (
            <span key={x} className="pointer-events-none absolute inset-y-0 border-l border-white/15" style={{ left: `${at(x) * 100}%` }}>
              <span className="absolute bottom-0.5 left-1 text-[10px] leading-4 text-white/60 tabular-nums">{x}s</span>
            </span>
          ))}
        {/* Outside the text's time: dimmed. */}
        {shown.length === 0 ? (
          <span className="pointer-events-none absolute inset-0 bg-black/45" />
        ) : (
          gaps(shown, dur).map(([a, b], k) => (
            <span key={k} className="pointer-events-none absolute inset-y-0 bg-black/65" style={{ left: `${at(a) * 100}%`, width: `${(at(b) - at(a)) * 100}%` }} />
          ))
        )}
        {t !== null && t !== undefined && !draft && (
          <span
            className="pointer-events-none absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_3px_rgba(0,0,0,0.8)]"
            style={{ left: `${at(t) * 100}%` }}
          />
        )}
      </div>

      {shown.map(([a, b], k) => (
        <div
          key={k}
          data-part="body"
          onPointerDown={one ? onDown : undefined}
          onPointerMove={onMove}
          onPointerUp={up}
          onPointerCancel={up}
          className={`absolute inset-y-0 rounded-md border-y-[3px] border-coral ${one && !disabled ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"} ${
            one ? "" : "border-x-[3px]"
          }`}
          style={{ left: inset(a), right: `calc(0.875rem + (100% - 1.75rem) * ${1 - at(b)})` }}
        />
      ))}
      {one && (
        <>
          <Handle
            side="start"
            style={{ left: `calc((100% - 1.75rem) * ${at(one[0])})` }}
            label={`start of ${label}`}
            value={one[0]}
            min={0}
            max={one[1] - MIN_S}
            disabled={disabled}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={up}
            onKeyDown={key("start")}
          />
          <Handle
            side="end"
            style={{ left: inset(one[1]) }}
            label={`end of ${label}`}
            value={one[1]}
            min={one[0] + MIN_S}
            max={dur}
            disabled={disabled}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={up}
            onKeyDown={key("end")}
          />
        </>
      )}
    </div>
  );
}

/** Seconds to mark on a strip this long (about 3-6 marks). */
function ticks(total: number): number[] {
  const step = [1, 2, 5, 10, 15, 30, 60].find((x) => total / x <= 6) ?? 60;
  const out: number[] = [];
  for (let x = step; x < total - step * 0.3; x += step) out.push(x);
  return out;
}

/** The parts of 0..total outside the spans. */
function gaps(spans: Span[], total: number): Span[] {
  const out: Span[] = [];
  let t = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (a > t) out.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < total) out.push([t, total]);
  return out;
}

function Handle({
  side,
  style,
  label,
  value,
  min,
  max,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  side: "start" | "end";
  style: CSSProperties;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}) {
  return (
    <span
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-valuemin={Math.round(min * 10) / 10}
      aria-valuemax={Math.round(max * 10) / 10}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuetext={fmtS(value)}
      data-part={side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      style={style}
      className={`absolute inset-y-0 flex w-3.5 items-center justify-center bg-coral text-black outline-none focus-visible:ring-2 focus-visible:ring-white ${
        disabled ? "" : "cursor-ew-resize"
      } ${side === "start" ? "rounded-l-md" : "rounded-r-md"} before:absolute before:-inset-x-3 before:inset-y-0 before:content-['']`}
    >
      <svg viewBox="0 0 6 12" aria-hidden="true" className="h-3 w-1.5">
        <path d={side === "start" ? "M5 1 1 6l4 5" : "M1 1l4 5-4 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** "Only on these shots": one chip per shot; the text shows on the ones picked. */
export function ShotChips({
  shots,
  picked,
  onToggle,
  onAll,
  allOn,
  disabled,
}: {
  shots: TimelineShot[];
  picked: number[];
  onToggle: (k: number) => void;
  /** "the whole video". */
  onAll?: () => void;
  allOn?: boolean;
  disabled?: boolean;
}) {
  if (shots.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 text-muted">show on</span>
      {onAll && (
        <button type="button" disabled={disabled} aria-pressed={!!allOn} onClick={onAll} className={chipClass(!!allOn)}>
          whole video
        </button>
      )}
      {shots.map((s, k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          aria-pressed={picked.includes(k)}
          aria-label={s.label}
          onClick={() => onToggle(k)}
          className={chipClass(picked.includes(k))}
        >
          {s.label.replace(/^shot /, "")}
        </button>
      ))}
    </div>
  );
}
