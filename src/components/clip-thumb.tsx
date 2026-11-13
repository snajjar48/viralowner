"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/video-options";

/**
 * A 9:16 still of a clip with a duration badge. Shows the clip's saved still (`image`) when there
 * is one: an image loads instantly, where a video has to download before it shows anything.
 * Falls back to the video's own first frame.
 */
export function ClipThumb({
  src,
  image = null,
  durationS,
  label,
  className = "w-full",
}: {
  src: string | null;
  /** A JPEG still of the clip (made when it was picked). */
  image?: string | null;
  durationS: number | null;
  label: string;
  /** Include a width (defaults to w-full). */
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!image && failed !== image;
  return (
    <div className={`relative aspect-[9/16] shrink-0 overflow-hidden rounded-xl bg-white/[0.04] ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed storage URL; nothing to optimize
        <img
          src={image}
          alt={label}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(image)}
          className="pointer-events-none size-full object-cover"
        />
      ) : (
        src && (
          // "#t=0.1" makes iOS Safari show a frame instead of a blank box.
          <video
            src={`${src}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            aria-label={label}
            className="pointer-events-none size-full object-cover"
          />
        )
      )}
      {durationS !== null && (
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs tabular-nums text-white">
          {formatDuration(durationS)}
        </span>
      )}
    </div>
  );
}
