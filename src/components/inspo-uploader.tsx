"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CategoryPicker } from "@/components/category-picker";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { DropZone } from "@/components/drop-zone";
import { buttonClass } from "@/components/form";
import { AlertIcon, RefreshIcon, SparkleIcon } from "@/components/icons";
import { ProgressBar } from "@/components/progress-bar";
import {
  postJson,
  readVideoDuration,
  SOLO_PART_CONCURRENCY,
  uploadInParts,
  uploadToSignedUrl,
  UploadError,
} from "@/lib/upload-client";
import type { VideoCategory } from "@/lib/categories";
import { checkInspo, formatBytes, VIDEO_ACCEPT } from "@/lib/video-files";
import { formatDuration } from "@/lib/video-options";

type Upload = { url: string; headers: Record<string, string> };
type Picked = { file: File; durationS: number | null; previewUrl: string };
type Background = { state: "idle" | "uploading" | "done" | "failed"; percent: number; message?: string };
type Phase =
  | { name: "pick" }
  | { name: "reading" }
  | { name: "ready" }
  | { name: "uploading"; percent: number }
  /** The button was tapped; the upload that started on picking is finishing. */
  | { name: "waiting" }
  | { name: "analyzing" }
  | { name: "failed"; message: string; retry: "upload" | "analyze" | "pick" };

/**
 * Step 1. Pick an inspo (validated in the browser), upload it straight to
 * storage, then have it analyzed. Used for a new project (/new) and to
 * replace the inspo of an existing one.
 */
export function InspoUploader({
  projectId: existingProjectId,
  category: initialCategory = null,
}: {
  projectId?: string;
  /** The video's kind, when replacing the inspo of a video that has one. */
  category?: VideoCategory | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickError, setPickError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [category, setCategory] = useState<VideoCategory | null>(initialCategory);
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const projectId = useRef(existingProjectId ?? null);
  const abort = useRef<AbortController | null>(null);
  // A parts upload still to be joined by the server (kept for "try again").
  const partsUploadId = useRef<string | undefined>(undefined);
  // The file's upload, started as soon as it's picked (new videos).
  const uploading = useRef<Promise<string | undefined> | null>(null);
  const [bg, setBg] = useState<Background>({ state: "idle", percent: 0 });

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.previewUrl);
  }, [picked]);

  async function onFiles([file]: File[]) {
    setPickError("");
    setPhase({ name: "reading" });
    // Quick checks first, so a wrong file type fails instantly.
    const early = checkInspo(file, null);
    if (early) {
      setPicked(null);
      setPickError(early);
      setPhase({ name: "pick" });
      return;
    }
    const durationS = await readVideoDuration(file, 4_000); // (the server reads it too)
    const problem = checkInspo(file, durationS);
    if (problem) {
      setPicked(null);
      setPickError(problem);
      setPhase({ name: "pick" });
      return;
    }
    setPicked({ file, durationS, previewUrl: URL.createObjectURL(file) });
    setPhase({ name: "ready" });
    // A new video: upload right away. (Replacing an inspo waits for the button, so the current
    // one stays until the user confirms the new one.)
    if (!existingProjectId) void startUpload(file, durationS).catch(() => {});
  }

  /**
   * Uploads the picked file. For a new video it starts the moment the file is picked, while the
   * user picks the kind of video and confirms: by the time they tap the button it's often done.
   * Resolves to the parts upload's id (to be joined by the server), if it went up in parts.
   */
  function startUpload(file: File, durationS: number | null): Promise<string | undefined> {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    partsUploadId.current = undefined;
    setBg({ state: "uploading", percent: 0 });
    const details = { fileName: file.name, contentType: file.type, sizeBytes: file.size, durationS, ...(category ? { category } : {}) };
    const run = async () => {
      type Started = { upload: Upload; multipart: { uploadId: string; partBytes: number; urls: string[] } | null };
      let started: Started;
      if (projectId.current) {
        started = await postJson<Started>(`/api/projects/${projectId.current}/inspo`, details);
      } else {
        const res = await postJson<Started & { projectId: string }>("/api/projects", details);
        projectId.current = res.projectId;
        started = res;
      }
      const onProgress = (percent: number) => {
        if (abort.current === controller) setBg({ state: "uploading", percent });
      };
      if (started.multipart) {
        try {
          // Big file: several parts at once.
          await uploadInParts(file, started.multipart, onProgress, controller.signal, SOLO_PART_CONCURRENCY);
          partsUploadId.current = started.multipart.uploadId;
          return started.multipart.uploadId;
        } catch (e) {
          if (controller.signal.aborted) throw e;
          onProgress(0);
        }
      }
      await uploadToSignedUrl(file, started.upload, onProgress, controller.signal);
      return undefined;
    };
    const promise = run();
    promise.then(
      () => abort.current === controller && setBg({ state: "done", percent: 100 }),
      (error) => {
        if (abort.current !== controller) return; // replaced by a newer upload
        if (controller.signal.aborted) {
          // Canceled: the button starts it again.
          uploading.current = null;
          setBg({ state: "idle", percent: 0 });
          return;
        }
        setBg({
          state: "failed",
          percent: 0,
          message: error instanceof UploadError ? error.message : "the upload didn’t go through. please try again.",
        });
      },
    );
    uploading.current = promise;
    return promise;
  }

  async function analyze(uploadId?: string) {
    setPhase({ name: "analyzing" });
    try {
      await postJson(`/api/projects/${projectId.current}/inspo/complete`, {
        ...(uploadId ? { uploadId } : {}),
        category,
        styleReferenceConfirmed: true,
      });
      router.push(`/projects/${projectId.current}/breakdown`);
    } catch (error) {
      const code = (error as { data?: { code?: string } }).data?.code;
      if (uploadId && code === "upload_missing" && picked && projectId.current) {
        // The parts couldn't be joined: send the file in one go, then try once more.
        partsUploadId.current = undefined;
        try {
          const { upload: target } = await postJson<{ upload: Upload }>(`/api/projects/${projectId.current}/inspo`, {
            fileName: picked.file.name,
            contentType: picked.file.type,
            sizeBytes: picked.file.size,
            durationS: picked.durationS,
            single: true,
          });
          setPhase({ name: "uploading", percent: 0 });
          await uploadToSignedUrl(picked.file, target, (percent) => setPhase({ name: "uploading", percent }));
          return analyze();
        } catch {
          // fall through to the usual message
        }
      }
      setPhase({
        name: "failed",
        message: error instanceof UploadError ? error.message : "something went wrong. please try again.",
        retry: code === "invalid_file" ? "pick" : code === "upload_missing" ? "upload" : "analyze",
      });
    }
  }

  /** The button: finishes the upload (usually already done) and starts the analysis. */
  async function upload() {
    if (!picked || !confirmed) return;
    // Not started yet (replacing an inspo), or it stopped: (re)start it now.
    const pending =
      uploading.current && (bg.state === "uploading" || bg.state === "done") ? uploading.current : startUpload(picked.file, picked.durationS);
    setPhase({ name: "waiting" });
    let uploadId: string | undefined;
    try {
      uploadId = await pending;
    } catch (error) {
      if (abort.current?.signal.aborted) {
        setPhase({ name: "ready" });
        return;
      }
      setPhase({
        name: "failed",
        message: error instanceof UploadError ? error.message : "the upload didn’t go through. please try again.",
        retry: "upload",
      });
      return;
    }
    await analyze(uploadId);
  }

  function startOver() {
    abort.current?.abort();
    uploading.current = null;
    setBg({ state: "idle", percent: 0 });
    setPicked(null);
    setPhase({ name: "pick" });
  }

  if (phase.name === "analyzing") {
    return (
      <div role="status" className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center">
        <span className="relative flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-linear-to-r from-violet to-coral opacity-30 motion-reduce:animate-none" />
          <span className="relative flex size-16 items-center justify-center rounded-full bg-linear-to-r from-violet to-coral text-white">
            <SparkleIcon className="size-7" />
          </span>
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-medium">studying your video...</p>
          <p className="text-sm text-muted">finding every cut, the pacing, and the text style. this takes a few seconds.</p>
        </div>
      </div>
    );
  }

  const busy = phase.name === "uploading" || phase.name === "reading" || phase.name === "waiting";

  return (
    <div className="flex flex-col gap-5">
      {!picked ? (
        <>
          <DropZone
            accept={VIDEO_ACCEPT}
            onFiles={onFiles}
            disabled={busy}
            title={phase.name === "reading" ? "checking your video..." : "upload the video you want to remake"}
            hint={
              <>
                <span className="sm:hidden">tap to choose from your camera roll.</span>
                <span className="hidden sm:inline">drag it here, or click to choose a file.</span> MP4 or MOV, up to{" "}
                60 seconds.
              </>
            }
          />
          {pickError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-coral">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              {pickError}
            </p>
          )}
        </>
      ) : (
        <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <video
            src={picked.previewUrl}
            muted
            playsInline
            preload="metadata"
            aria-label="the video you picked"
            className="aspect-[9/16] w-20 shrink-0 rounded-xl bg-black object-cover"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-sm font-medium">{picked.file.name}</p>
            <p className="text-sm text-muted">
              {picked.durationS !== null ? `${formatDuration(picked.durationS)} · ` : ""}
              {formatBytes(picked.file.size)}
            </p>
            {bg.state === "uploading" && phase.name !== "waiting" && (
              <div className="flex flex-col gap-1" aria-live="polite">
                <ProgressBar value={bg.percent} label="uploading" />
                <p className="text-xs text-muted">uploading while you finish below</p>
              </div>
            )}
            {bg.state === "done" && <p className="text-xs text-emerald-300">uploaded</p>}
            {bg.state === "failed" && phase.name !== "failed" && (
              <p className="text-xs text-coral">{bg.message} we’ll try again when you tap the button.</p>
            )}
            {!busy && (
              <button
                type="button"
                onClick={startOver}
                className="w-fit cursor-pointer text-sm text-foreground underline decoration-white/30 underline-offset-4 hover:decoration-white focus-visible:outline-2 focus-visible:outline-coral"
              >
                choose a different video
              </button>
            )}
          </div>
        </div>
      )}

      <details className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">how do i get a video from TikTok or Instagram?</summary>
        <div className="flex flex-col gap-3 pt-3 text-muted">
          <p>
            <span className="font-medium text-foreground">TikTok:</span> open the video, tap the share arrow, then tap{" "}
            <span className="text-foreground">save video</span>. it goes to your camera roll.
          </p>
          <p>
            <span className="font-medium text-foreground">Instagram, or if there’s no save button:</span> screen-record it.
            on iPhone, swipe down from the top-right corner and tap the record button (a circle; if it’s not there, add
            “screen recording” in settings › control center). on Android, swipe down
            from the top and tap <span className="text-foreground">screen record</span>. play the video, stop the
            recording, and it’s in your camera roll.
          </p>
          <p>then come back here and tap the box above to pick it.</p>
        </div>
      </details>

      <CategoryPicker value={category} onChange={setCategory} disabled={busy} />

      <ConsentCheckbox checked={confirmed} onChange={setConfirmed} disabled={busy}>
        i’m using this video only as a style reference.
      </ConsentCheckbox>

      {(phase.name === "uploading" || phase.name === "waiting") && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <ProgressBar value={phase.name === "uploading" ? phase.percent : bg.percent} label="uploading your video" />
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="w-fit cursor-pointer self-center text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            cancel
          </button>
        </div>
      )}

      {phase.name === "failed" && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-coral/30 bg-coral/[0.06] p-4">
          <p className="flex items-start gap-2 text-sm">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-coral" />
            {phase.message}
          </p>
          <div className="flex flex-wrap gap-2">
            {phase.retry !== "pick" && picked && (
              <button
                type="button"
                onClick={phase.retry === "analyze" ? () => analyze(partsUploadId.current) : upload}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
              >
                <RefreshIcon className="size-4" /> try again
              </button>
            )}
            <button
              type="button"
              onClick={startOver}
              className="h-10 cursor-pointer rounded-full px-4 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
            >
              choose a different video
            </button>
          </div>
        </div>
      )}

      {phase.name !== "uploading" && phase.name !== "waiting" && phase.name !== "failed" && (
        <button
          type="button"
          onClick={upload}
          disabled={!picked || !confirmed || busy}
          className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none`}
        >
          {bg.state === "done" ? "next: break it down" : "upload & break it down"}
        </button>
      )}
    </div>
  );
}
