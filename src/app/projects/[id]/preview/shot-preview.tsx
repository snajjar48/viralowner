"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PlayIcon, XIcon } from "@/components/icons";

type Props = {
  label: string;
  src: string;
  poster: string | null;
  durationS: number;
  /** The trim (null = the start / end of the clip). */
  start: number | null;
  end: number | null;
  onSetStart: (t: number | null) => void;
  onSetEnd: (t: number | null) => void;
};

/** The shortest a shot can be trimmed to. */
const MIN_S = 0.3;
const FRAMES = 8;

/**
 * A shot's clip, trimmed like a video in the phone's photos: a strip of the clip's frames with a
 * handle on each end. Drag the handles to choose the part in the shot (the picture follows them);
 * tap or drag anywhere else on the strip to look at that moment. Tap the picture for a bigger player
 * on the same page, with the same trimmer.
 */
export function ShotPreview(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // The strip's frames cost a download from the clip: only once they're wanted (the trimmer touched,
  // or the bigger player opened); until then the clip's still stands in.
  const [wantStrip, setWantStrip] = useState(false);

  function show() {
    setOpen(true);
    setWantStrip(true);
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  return (
    <>
      <Player {...props} size="small" onOpen={show} wantStrip={wantStrip} onWantStrip={() => setWantStrip(true)} />
      <dialog
        ref={dialog}
        aria-label={`${props.label}, bigger`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close(); // a tap outside closes it
        }}
        className="m-auto w-[min(26rem,calc(100%-2rem))] rounded-3xl border border-white/10 bg-[#141419] p-4 text-foreground shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">{props.label}</p>
          <button
            type="button"
            onClick={close}
            aria-label="close"
            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        {/* Mounted only while open, so it starts fresh (and stops) each time. */}
        {open && <Player {...props} size="big" wantStrip onWantStrip={() => {}} />}
        <button
          type="button"
          onClick={close}
          className="mt-4 h-11 w-full cursor-pointer rounded-full bg-white/10 text-sm font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
        >
          done
        </button>
      </dialog>
    </>
  );
}

function Player({
  label,
  src,
  poster,
  durationS,
  start,
  end,
  onSetStart,
  onSetEnd,
  size,
  onOpen,
  wantStrip,
  onWantStrip,
}: Props & { size: "small" | "big"; onOpen?: () => void; wantStrip: boolean; onWantStrip: () => void }) {
  const big = size === "big";
  const video = useRef<HTMLVideoElement>(null);
  /** A jump asked for while the last is still landing. */
  const pending = useRef<number | null>(null);
  /** Whether it has played yet (phones draw no frames before). */
  const primed = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(start ?? 0);
  const [loaded, setLoaded] = useState(big);
  const a = Math.max(0, start ?? 0);
  const b = Math.min(durationS, end ?? durationS);
  const frames = useFilmstrip(src, durationS, wantStrip);

  // Keep playback inside the shot: loop back to its start at its end.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const tick = () => {
      setT(v.currentTime);
      if (!v.paused && v.currentTime >= b - 0.03) v.currentTime = a;
    };
    v.addEventListener("timeupdate", tick);
    return () => v.removeEventListener("timeupdate", tick);
  }, [a, b]);

  // The big player starts playing the shot as soon as it opens.
  useEffect(() => {
    const v = video.current;
    if (!big || !v) return;
    v.currentTime = a;
    primed.current = true;
    void v.play().catch(() => setPlaying(false));
    // Only when it opens: later trim changes don't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big]);

  function toggle() {
    const v = video.current;
    if (!v) return;
    setLoaded(true);
    primed.current = true;
    if (v.paused) {
      if (v.currentTime < a - 0.05 || v.currentTime >= b - 0.05) v.currentTime = a;
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }

  // While dragging: one jump at a time (each new one would cancel the last before it shows), going
  // to the latest place asked for when the last one lands.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const landed = () => {
      const next = pending.current;
      pending.current = null;
      if (next !== null && Math.abs(v.currentTime - next) > 0.01) v.currentTime = next;
    };
    v.addEventListener("seeked", landed);
    return () => v.removeEventListener("seeked", landed);
  }, []);

  /** Shows this moment (paused), as the handles or the strip are dragged. */
  function seek(to: number) {
    const v = video.current;
    setT(to);
    if (!v) return;
    setLoaded(true);
    if (!primed.current) {
      // Phones only draw a video's frames once it has played: a muted start-and-stop, the first time.
      primed.current = true;
      const muted = v.muted;
      v.muted = true;
      v.preload = "auto";
      void v
        .play()
        .then(() => {
          v.pause();
          v.muted = muted;
          v.currentTime = pending.current ?? to;
          pending.current = null;
        })
        .catch(() => {
          v.muted = muted;
        });
      pending.current = to;
      return;
    }
    v.pause();
    if (v.seeking) pending.current = to;
    else v.currentTime = to;
  }

  const picture = (
    <>
      <video
        ref={video}
        src={src}
        poster={poster ?? undefined}
        playsInline
        preload={loaded ? "auto" : "none"}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        className="size-full object-cover"
      />
      {!playing && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/35">
          <span
            className={`flex items-center justify-center rounded-full bg-white/90 text-black ${big ? "size-14" : "size-8"}`}
          >
            <PlayIcon className={big ? "ml-1 size-7" : "ml-0.5 size-4"} />
          </span>
        </span>
      )}
    </>
  );

  const trimmed = start !== null || end !== null;
  const trimmer = (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2" onPointerDownCapture={onWantStrip}>
      <Trimmer
        label={label}
        durationS={durationS}
        a={a}
        b={b}
        t={t}
        frames={frames}
        poster={poster}
        tall={big}
        onScrub={seek}
        onStart={(x) => {
          onSetStart(x);
          seek(x);
        }}
        onEnd={(x) => {
          onSetEnd(x);
          seek(x);
        }}
      />
      <div className="flex items-center gap-2 text-xs">
        <span className="mr-auto text-muted tabular-nums">
          {trimmed ? `${fmt(a)} – ${fmt(b)} · ${fmt(b - a)} long` : `whole clip · ${fmt(durationS)}`}
        </span>
        {trimmed ? (
          <button
            type="button"
            onClick={() => {
              onSetStart(null);
              onSetEnd(null);
            }}
            className="h-7 cursor-pointer rounded-full bg-white/10 px-3 font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
          >
            undo trim
          </button>
        ) : (
          <span className="text-muted">drag the ends to trim</span>
        )}
      </div>
    </div>
  );

  if (big) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={`${playing ? "pause" : "play"} ${label}`}
          className="group relative mx-auto aspect-[9/16] max-h-[55dvh] w-full cursor-pointer overflow-hidden rounded-2xl bg-black focus-visible:outline-2 focus-visible:outline-coral"
        >
          {picture}
        </button>
        {trimmer}
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => {
          video.current?.pause();
          onOpen?.();
        }}
        aria-label={`watch ${label} bigger`}
        className="group relative aspect-[9/16] w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-black focus-visible:outline-2 focus-visible:outline-coral"
      >
        {picture}
      </button>
      {trimmer}
    </div>
  );
}

const fmt = (s: number) => `${(Math.round(s * 10) / 10).toFixed(1)}s`;
const snap = (s: number) => Math.round(s * 20) / 20; // to 0.05s

/**
 * The strip: the clip's frames, a coral frame around the part in the shot with a handle on each
 * end, the rest dimmed, and a line where the picture is.
 */
function Trimmer({
  label,
  durationS,
  a,
  b,
  t,
  frames,
  poster,
  tall,
  onScrub,
  onStart,
  onEnd,
}: {
  label: string;
  durationS: number;
  a: number;
  b: number;
  t: number;
  frames: string[] | null;
  poster: string | null;
  tall: boolean;
  onScrub: (t: number) => void;
  onStart: (t: number) => void;
  onEnd: (t: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<"start" | "end" | "scrub" | null>(null);
  /** Where on a handle it was grabbed (so it doesn't jump to the finger). */
  const grab = useRef(0);
  const [dragging, setDragging] = useState<"start" | "end" | "scrub" | null>(null);
  const dur = Math.max(durationS, 0.1);
  const pct = (x: number) => `${(100 * Math.min(Math.max(x, 0), dur)) / dur}%`;

  function timeAt(clientX: number) {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur));
  }

  function move(kind: "start" | "end" | "scrub", x: number) {
    if (kind === "start") onStart(snap(Math.min(x, b - MIN_S)));
    else if (kind === "end") onEnd(snap(Math.max(x, a + MIN_S)));
    else onScrub(x);
  }

  function onDown(e: ReactPointerEvent<HTMLElement>) {
    const kind = (e.currentTarget.dataset.part ?? "scrub") as "start" | "end" | "scrub";
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = kind;
    setDragging(kind);
    const at = timeAt(e.clientX);
    grab.current = kind === "start" ? a - at : kind === "end" ? b - at : 0;
    if (kind === "scrub") move(kind, at);
  }

  function onMove(e: ReactPointerEvent<HTMLElement>) {
    if (drag.current) move(drag.current, timeAt(e.clientX) + grab.current);
  }

  function up() {
    drag.current = null;
    setDragging(null);
  }

  function key(kind: "start" | "end") {
    return (e: KeyboardEvent) => {
      const step = e.shiftKey ? 1 : 0.1;
      const at = kind === "start" ? a : b;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") move(kind, at - step);
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") move(kind, at + step);
      else return;
      e.preventDefault();
    };
  }

  const tiles = frames ?? Array.from({ length: FRAMES }, () => poster);
  const h = tall ? "h-14" : "h-11";

  return (
    <div className={`relative ${h} touch-none select-none px-3.5`}>
      {/* The strip (inset by the handles' width, so the handles sit on its ends at 0 and the end). */}
      <div
        ref={track}
        data-part="scrub"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={up}
        onPointerCancel={up}
        className="relative size-full cursor-pointer overflow-hidden rounded-md bg-white/5"
      >
        <div className="absolute inset-0 flex">
          {tiles.map((src, i) =>
            src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
            ) : (
              <span key={i} className="h-full min-w-0 flex-1 border-r border-black/30 bg-white/10" />
            ),
          )}
        </div>
        {/* Outside the shot: dimmed. */}
        <span className="pointer-events-none absolute inset-y-0 left-0 bg-black/65" style={{ width: pct(a) }} />
        <span className="pointer-events-none absolute inset-y-0 right-0 bg-black/65" style={{ width: `calc(100% - ${pct(b)})` }} />
        {/* Where the picture is. */}
        {dragging !== "start" && dragging !== "end" && (
          <span
            className="pointer-events-none absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_3px_rgba(0,0,0,0.8)]"
            style={{ left: pct(t) }}
          />
        )}
      </div>

      {/* The coral frame around the part in the shot, with its two handles. */}
      <div
        className="pointer-events-none absolute inset-y-0 rounded-md border-y-[3px] border-coral"
        style={{ left: `calc(0.875rem + (100% - 1.75rem) * ${a / dur})`, right: `calc(0.875rem + (100% - 1.75rem) * ${1 - b / dur})` }}
      />
      <Handle
        side="start"
        style={{ left: `calc((100% - 1.75rem) * ${a / dur})` }}
        label={`start of ${label}`}
        value={a}
        min={0}
        max={b - MIN_S}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={up}
        onKeyDown={key("start")}
      />
      <Handle
        side="end"
        style={{ left: `calc(0.875rem + (100% - 1.75rem) * ${b / dur})` }}
        label={`end of ${label}`}
        value={b}
        min={a + MIN_S}
        max={durationS}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={up}
        onKeyDown={key("end")}
      />
    </div>
  );
}

function Handle({
  side,
  style,
  label,
  value,
  min,
  max,
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
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}) {
  return (
    <span
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={Math.round(min * 10) / 10}
      aria-valuemax={Math.round(max * 10) / 10}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuetext={fmt(value)}
      data-part={side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      style={style}
      className={`absolute inset-y-0 flex w-3.5 cursor-ew-resize items-center justify-center bg-coral text-black outline-none focus-visible:ring-2 focus-visible:ring-white ${
        side === "start" ? "rounded-l-md" : "rounded-r-md"
      } before:absolute before:-inset-x-3 before:inset-y-0 before:content-['']`}
    >
      <svg viewBox="0 0 6 12" aria-hidden="true" className="h-3 w-1.5">
        <path
          d={side === "start" ? "M5 1 1 6l4 5" : "M1 1l4 5-4 5"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// ---- The strip's frames: grabbed from the clip in the browser, one clip at a time, kept per clip.

const strips = new Map<string, Promise<string[] | null>>();
let queue: Promise<unknown> = Promise.resolve();

function useFilmstrip(src: string, durationS: number, wanted: boolean): string[] | null {
  const [frames, setFrames] = useState<{ src: string; frames: string[] | null } | null>(null);
  useEffect(() => {
    let live = true;
    let job = strips.get(src);
    if (!job && !wanted) return;
    if (!job) {
      job = queue.then(() => grabFrames(src, durationS, FRAMES)).catch(() => null);
      queue = job;
      strips.set(src, job);
    }
    void job.then((f) => {
      if (live) setFrames({ src, frames: f });
    });
    return () => {
      live = false;
    };
  }, [src, durationS, wanted]);
  return frames?.src === src ? frames.frames : null;
}

function waitFor(v: HTMLVideoElement, event: string, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      v.removeEventListener(event, ok);
      reject(new Error(`${event} timed out`));
    }, ms);
    const ok = () => {
      clearTimeout(timer);
      resolve();
    };
    v.addEventListener(event, ok, { once: true });
  });
}

async function grabFrames(src: string, durationS: number, n: number): Promise<string[] | null> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous"; // so the frames can be read (storage allows this site)
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.setAttribute("aria-hidden", "true");
  Object.assign(v.style, { position: "fixed", left: "-2px", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(v);
  try {
    v.src = src;
    await waitFor(v, "loadedmetadata", 20_000);
    // Phones only load a picture after a play: start and stop straight away (muted, hidden).
    await v.play().catch(() => {});
    v.pause();
    const canvas = document.createElement("canvas");
    const H = 112;
    const W = 64;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const out: string[] = [];
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : durationS;
    for (let i = 0; i < n; i++) {
      v.currentTime = Math.min(dur - 0.05, ((i + 0.5) * dur) / n);
      await waitFor(v, "seeked", 10_000);
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      if (!vw || !vh) return null;
      // Cover: crop the frame to the tile's shape.
      const scale = Math.max(W / vw, H / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
      out.push(canvas.toDataURL("image/jpeg", 0.7));
    }
    return out;
  } catch {
    return null; // the clip's still stands in
  } finally {
    v.removeAttribute("src");
    v.load();
    v.remove();
  }
}
