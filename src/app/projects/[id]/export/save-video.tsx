"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { buttonClass } from "@/components/form";

/** "share": a phone that can hand a video file to other apps (Save Video, TikTok, Instagram…). */
type Device = "unknown" | "share" | "phone" | "computer";
type Prepared = { percent: number | null } | { file: File } | "failed";

let device: Device | null = null;
function detectDevice(): Device {
  if (device) return device;
  // A computer's share sheet can't post to TikTok or Instagram, so phones only.
  const phone = window.matchMedia("(pointer: coarse)").matches;
  const probe = new File([], "video.mp4", { type: "video/mp4" });
  const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
  device = phone ? (canShareFiles ? "share" : "phone") : "computer";
  return device;
}
const noSubscribe = () => () => {};

const secondaryClass =
  "flex h-12 w-full items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral";

/**
 * The video, plus the ways to get it out. On phones that can share files, the
 * video is fetched in the background so "save or share" opens the share sheet
 * straight away: a share has to start right on the tap, so it can't wait for a
 * 20 MB download. Everywhere else (or if that fails), a plain download.
 */
export function SaveVideo({ fileUrl, fileName }: { fileUrl: string; fileName: string }) {
  const kind = useSyncExternalStore(noSubscribe, detectDevice, () => "unknown" as Device);
  const [prepared, setPrepared] = useState<Prepared>({ percent: null });
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "share") return;
    const controller = new AbortController();
    (async () => {
      const res = await fetch(fileUrl, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`video fetch failed (${res.status})`);
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (total) setPrepared({ percent: Math.min(99, Math.round((got / total) * 100)) });
      }
      setPrepared({ file: new File(chunks, fileName, { type: "video/mp4" }) });
    })().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      console.error("Preparing the video to share failed:", error);
      setPrepared("failed");
    });
    return () => controller.abort();
  }, [kind, fileUrl, fileName]);

  async function shareVideo() {
    if (typeof prepared !== "object" || !("file" in prepared)) return;
    setNote(null);
    try {
      await navigator.share({ files: [prepared.file] });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return; // they closed the sheet
      setNote("sharing didn’t work on this phone. use download video below instead.");
    }
  }

  const sharing = kind === "share" && prepared !== "failed";
  const ready = typeof prepared === "object" && "file" in prepared;
  const percent = typeof prepared === "object" && "percent" in prepared ? prepared.percent : null;
  const phoneWithoutShare = kind === "phone" || (kind === "share" && prepared === "failed");

  return (
    <div className="flex flex-col gap-3">
      <video
        src={fileUrl}
        controls
        playsInline
        preload="metadata"
        className="mx-auto aspect-[9/16] max-h-[min(60vh,520px)] w-auto rounded-2xl border border-white/10 bg-black"
      />

      {sharing && (
        <>
          <button type="button" onClick={shareVideo} disabled={!ready} className={buttonClass}>
            {ready ? "save or share video" : `getting your video ready${percent != null ? ` · ${percent}%` : "…"}`}
          </button>
          <p className="-mt-1 text-center text-xs text-muted">
            pick “save video” to keep it in your photos, or tiktok / instagram to post it now.
          </p>
        </>
      )}
      {note && (
        <p role="alert" className="text-center text-sm text-coral">
          {note}
        </p>
      )}

      <a
        href={`${fileUrl}?download=1`}
        download={fileName}
        className={sharing ? secondaryClass : `${buttonClass} flex items-center justify-center`}
      >
        download video
      </a>
      {phoneWithoutShare && (
        <p className="-mt-1 text-center text-xs text-muted">on iphone: tap download, then the share button → save video.</p>
      )}
      {kind === "computer" && (
        <p className="-mt-1 text-center text-xs text-muted">
          posting from your phone? log in to viralowner there and open this page to save it straight to your photos.
        </p>
      )}
    </div>
  );
}
