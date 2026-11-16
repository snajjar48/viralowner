"use client";

import { useState } from "react";

const SIZES = {
  /** Thumbnail-sized, e.g. the inspo on the breakdown page. */
  sm: "w-40 sm:w-48",
  md: "w-60 sm:w-72",
  /** As big as fits on the screen (the finished edit). */
  fit: "w-[min(100%,calc((100dvh-12rem)*9/16))] max-w-sm",
} as const;

/** A 9:16 video player with loading and error states. */
export function VideoPlayer({
  src,
  poster,
  size = "md",
  label,
  autoPlay = false,
  className = "",
  videoRef,
  overlay,
}: {
  src: string | null;
  poster?: string;
  size?: keyof typeof SIZES;
  /** Accessible name, e.g. "your inspo video". */
  label: string;
  autoPlay?: boolean;
  className?: string;
  /** To read the playhead or seek from outside. */
  videoRef?: React.Ref<HTMLVideoElement>;
  /** Drawn over the picture (not over the controls), e.g. a live preview of text. */
  overlay?: React.ReactNode;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  return (
    <div
      className={`relative aspect-[9/16] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black ${SIZES[size]} ${className}`}
    >
      {src ? (
        <video
          key={src}
          ref={videoRef}
          src={src}
          poster={poster}
          aria-label={label}
          controls
          playsInline
          autoPlay={autoPlay}
          muted={autoPlay}
          loop={autoPlay}
          preload="metadata"
          onLoadedData={() => setState("ready")}
          onCanPlay={() => setState("ready")}
          onError={() => setState("error")}
          className="size-full object-cover"
        />
      ) : null}
      {overlay && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 [container-type:size]">
          {overlay}
        </div>
      )}
      {(state === "loading" || !src) && state !== "error" && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 animate-pulse bg-white/[0.04]" />
      )}
      {state === "error" && (
        <div role="alert" className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted">
          couldn’t load this video. refresh to try again.
        </div>
      )}
    </div>
  );
}
