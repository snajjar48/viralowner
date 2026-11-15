"use client";

import { useEffect, useRef, useState } from "react";
import { PlayIcon, XIcon } from "@/components/icons";

type Props = {
  label: string;
  src: string;
  poster: string | null;
  durationS: number;
  /** The trim (null = the start / end of the clip). */
  start: number | null;
  end: number | null;
  onSetStart: (t: number) => void;
  onSetEnd: (t: number) => void;
};

/**
 * A shot's clip you can check: drag the bar to any moment and set the shot's start or end right
 * there. Tap the thumbnail for a bigger player on the same page (it plays just the part in the
 * shot, looping, with the same controls).
 */
export function ShotPreview(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function show() {
    setOpen(true);
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  return (
    <>
      <Player {...props} size="small" onOpen={show} />
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
        {open && <Player {...props} size="big" />}
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
}: Props & { size: "small" | "big"; onOpen?: () => void }) {
  const big = size === "big";
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(start ?? 0);
  const [loaded, setLoaded] = useState(big);
  const a = Math.max(0, start ?? 0);
  const b = Math.min(durationS, end ?? durationS);

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
    void v.play().catch(() => setPlaying(false));
    // Only when it opens: later trim changes don't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big]);

  function toggle() {
    const v = video.current;
    if (!v) return;
    setLoaded(true);
    if (v.paused) {
      if (v.currentTime < a - 0.05 || v.currentTime >= b - 0.05) v.currentTime = a;
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }

  function seek(to: number) {
    const v = video.current;
    if (!v) return;
    setLoaded(true);
    v.pause();
    v.currentTime = to;
    setT(to);
  }

  const pct = (x: number) => `${(100 * x) / Math.max(durationS, 0.1)}%`;
  const now = Math.round(t * 10) / 10;

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

  const controls = (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
      <div className="relative h-6">
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/10" />
        {/* The part of the clip in the shot. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-coral"
          style={{ left: pct(a), width: pct(Math.max(0, b - a)) }}
        />
        <input
          type="range"
          min={0}
          max={durationS}
          step={0.05}
          value={Math.min(t, durationS)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={`moment in ${label}`}
          aria-valuetext={`${now.toFixed(1)} seconds`}
          className="relative h-6 w-full cursor-pointer appearance-none bg-transparent accent-coral [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-auto text-muted tabular-nums">
          at {now.toFixed(1)}s · shot {a.toFixed(1)}–{b.toFixed(1)}s
        </span>
        <button
          type="button"
          onClick={() => onSetStart(now)}
          disabled={now >= b - 0.3}
          className="h-8 cursor-pointer rounded-full bg-white/10 px-3 font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-40"
        >
          start here
        </button>
        <button
          type="button"
          onClick={() => onSetEnd(now)}
          disabled={now <= a + 0.3}
          className="h-8 cursor-pointer rounded-full bg-white/10 px-3 font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-40"
        >
          end here
        </button>
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
          className="group relative mx-auto aspect-[9/16] max-h-[60dvh] w-full cursor-pointer overflow-hidden rounded-2xl bg-black focus-visible:outline-2 focus-visible:outline-coral"
        >
          {picture}
        </button>
        {controls}
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
        className="group relative aspect-[9/16] w-20 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-black focus-visible:outline-2 focus-visible:outline-coral"
      >
        {picture}
      </button>
      {controls}
    </div>
  );
}
