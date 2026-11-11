"use client";

import { useEffect, useRef, useState } from "react";
import { TRACKS, type Track } from "@/lib/video-options";
import { formatDuration } from "@/lib/video-options";
import { CheckIcon, PlayIcon } from "./icons";

const MOOD_NOTES: Record<string, number> = {
  upbeat: 392, hype: 440, chill: 294, dramatic: 220, energetic: 494, cozy: 262, confident: 349, playful: 523,
};

/**
 * Placeholder preview: a few seconds of synthesized beat at the track's
 * tempo. Replace with <audio src={track.previewUrl}> once real licensed
 * tracks exist.
 */
function playSynth(ctx: AudioContext, track: Track, seconds = 4) {
  const beat = 60 / track.bpm;
  const base = MOOD_NOTES[track.mood] ?? 330;
  const start = ctx.currentTime + 0.05;
  const master = ctx.createGain();
  master.gain.value = 0.15;
  master.connect(ctx.destination);
  for (let t = 0, i = 0; t < seconds; t += beat / 2, i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i % 2 ? "triangle" : "sine";
    osc.frequency.value = i % 4 === 0 ? base / 2 : base * [1, 1.25, 1.5, 1.25][i % 4];
    gain.gain.setValueAtTime(0.0001, start + t);
    gain.gain.exponentialRampToValueAtTime(i % 4 === 0 ? 1 : 0.5, start + t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + t + beat / 2);
    osc.connect(gain).connect(master);
    osc.start(start + t);
    osc.stop(start + t + beat / 2 + 0.05);
  }
  return () => master.disconnect();
}

/** The licensed-track library with preview buttons (radio group). */
export function TrackPicker({ value, onChange }: { value: string | null; onChange: (trackId: string) => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      stop.current?.();
      if (timer.current) clearTimeout(timer.current);
      void ctx.current?.close();
    },
    [],
  );

  function toggle(track: Track) {
    stop.current?.();
    stop.current = null;
    if (timer.current) clearTimeout(timer.current);
    if (playing === track.id) {
      setPlaying(null);
      return;
    }
    ctx.current ??= new AudioContext();
    void ctx.current.resume();
    stop.current = playSynth(ctx.current, track);
    setPlaying(track.id);
    timer.current = setTimeout(() => setPlaying(null), 4000);
  }

  return (
    <div role="radiogroup" aria-label="tracks" className="flex flex-col gap-2">
      {TRACKS.map((t) => {
        const checked = value === t.id;
        return (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-xl border p-2 pr-3 transition ${
              checked ? "border-coral/60 bg-coral/10" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <button
              type="button"
              onClick={() => toggle(t)}
              aria-label={`${playing === t.id ? "stop" : "preview"} ${t.title}`}
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
            >
              {playing === t.id ? <span className="size-3 rounded-sm bg-foreground" /> : <PlayIcon className="size-4" />}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(t.id)}
              className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 text-left focus-visible:outline-2 focus-visible:outline-coral"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{t.title}</span>
                <span className="truncate text-xs text-muted">
                  {t.artist} · {t.mood} · {formatDuration(t.durationS)}
                </span>
              </span>
              {checked && <CheckIcon className="size-4 shrink-0 text-coral" />}
            </button>
          </div>
        );
      })}
      <p className="text-xs text-muted">previews are placeholders until the licensed library is connected.</p>
    </div>
  );
}
