"use client";

import { formatDuration } from "@/lib/video-options";

/** A 9:16 still of a clip (its first frame) with a duration badge. */
export function ClipThumb({
  src,
  durationS,
  label,
  className = "w-full",
}: {
  src: string | null;
  durationS: number | null;
  label: string;
  /** Include a width (defaults to w-full). */
  className?: string;
}) {
  return (
    <div className={`relative aspect-[9/16] shrink-0 overflow-hidden rounded-xl bg-white/[0.04] ${className}`}>
      {src && (
        // "#t=0.1" makes iOS Safari show a frame instead of a blank box.
        <video
          src={`${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-label={label}
          className="pointer-events-none size-full object-cover"
        />
      )}
      {durationS !== null && (
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs tabular-nums text-white">
          {formatDuration(durationS)}
        </span>
      )}
    </div>
  );
}
