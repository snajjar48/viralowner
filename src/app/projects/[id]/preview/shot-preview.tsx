"use client";

import { useEffect, useRef, useState } from "react";
import { PlayIcon } from "@/components/icons";

/**
 * A shot's clip you can play: tap the thumbnail to watch just the part in the shot (it loops), drag
 * the bar to any moment of the clip, and set the shot's start or end right there.
 */
export function ShotPreview({
  label,
  src,
  poster,
  durationS,
  start,
  end,
  onSetStart,
  onSetEnd,
}: {
  label: string;
  src: string;
  poster: string | null;
  durationS: number;
  /** The trim (null = the start / end of the clip). */
  start: number | null;
  end: number | null;
  onSetStart: (t: number) => void;
  onSetEnd: (t: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(start ?? 0);
  const [loaded, setLoaded] = useState(false);
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

  function toggle() {
    const v = video.current;
    if (!v) return;
    setLoaded(true);
    if (v.paused) {
      if (v.currentTime < a - 0.05 || v.currentTime >= b - 0.05) v.currentTime = a;
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function seek(to: number) {
    const v = video.current;
    if (!v) return;
    setLoaded(true);
    v.pause();
    setPlaying(false);
    v.currentTime = to;
    setT(to);
  }

  const pct = (x: number) => `${(100 * x) / Math.max(durationS, 0.1)}%`;
  const now = Math.round(t * 10) / 10;

  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? "pause" : "play"} ${label}`}
        className="group relative aspect-[9/16] w-20 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-black focus-visible:outline-2 focus-visible:outline-coral"
      >
        <video
          ref={video}
          src={src}
          poster={poster ?? undefined}
          muted={false}
          playsInline
          preload={loaded ? "auto" : "none"}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          className="size-full object-cover"
        />
        {!playing && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/35">
            <span className="flex size-8 items-center justify-center rounded-full bg-white/90 text-black">
              <PlayIcon className="ml-0.5 size-4" />
            </span>
          </span>
        )}
      </button>

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
    </div>
  );
}
