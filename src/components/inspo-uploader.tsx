"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { DropZone } from "@/components/drop-zone";
import { buttonClass } from "@/components/form";
import { AlertIcon, RefreshIcon, SparkleIcon } from "@/components/icons";
import { ProgressBar } from "@/components/progress-bar";
import { postJson, readVideoDuration, uploadInParts, uploadToSignedUrl, UploadError } from "@/lib/upload-client";
import { checkInspo, formatBytes, VIDEO_ACCEPT } from "@/lib/video-files";
import { formatDuration } from "@/lib/video-options";

type Upload = { url: string; headers: Record<string, string> };
type Picked = { file: File; durationS: number | null; previewUrl: string };
type Phase =
  | { name: "pick" }
  | { name: "reading" }
  | { name: "ready" }
  | { name: "uploading"; percent: number }
  | { name: "analyzing" }
  | { name: "failed"; message: string; retry: "upload" | "analyze" | "pick" };

/**
 * Step 1. Pick an inspo (validated in the browser), upload it straight to
 * storage, then have it analyzed. Used for a new project (/new) and to
 * replace the inspo of an existing one.
 */
export function InspoUploader({ projectId: existingProjectId }: { projectId?: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickError, setPickError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const projectId = useRef(existingProjectId ?? null);
  const abort = useRef<AbortController | null>(null);
  // A parts upload still to be joined by the server (kept for "try again").
  const partsUploadId = useRef<string | undefined>(undefined);

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
    const durationS = await readVideoDuration(file);
    const problem = checkInspo(file, durationS);
    if (problem) {
      setPicked(null);
      setPickError(problem);
      setPhase({ name: "pick" });
      return;
    }
    setPicked({ file, durationS, previewUrl: URL.createObjectURL(file) });
    setPhase({ name: "ready" });
  }

  async function analyze(uploadId?: string) {
    setPhase({ name: "analyzing" });
    try {
      await postJson(`/api/projects/${projectId.current}/inspo/complete`, uploadId ? { uploadId } : undefined);
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
            styleReferenceConfirmed: true,
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

  async function upload() {
    if (!picked || !confirmed) return;
    const { file, durationS } = picked;
    const details = {
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      durationS,
      styleReferenceConfirmed: true,
    };
    setPhase({ name: "uploading", percent: 0 });
    abort.current = new AbortController();
    let uploadId: string | undefined;
    partsUploadId.current = undefined;
    try {
      type Started = { upload: Upload; multipart: { uploadId: string; partBytes: number; urls: string[] } | null };
      let started: Started;
      if (projectId.current) {
        started = await postJson<Started>(`/api/projects/${projectId.current}/inspo`, details);
      } else {
        const res = await postJson<Started & { projectId: string }>("/api/projects", details);
        projectId.current = res.projectId;
        started = res;
      }
      const onProgress = (percent: number) => setPhase({ name: "uploading", percent });
      if (started.multipart) {
        try {
          // Big file: several parts at once.
          await uploadInParts(file, started.multipart, onProgress, abort.current.signal);
          uploadId = started.multipart.uploadId;
          partsUploadId.current = uploadId;
        } catch (e) {
          if (abort.current.signal.aborted) throw e;
          onProgress(0);
          await uploadToSignedUrl(file, started.upload, onProgress, abort.current.signal);
        }
      } else {
        await uploadToSignedUrl(file, started.upload, onProgress, abort.current.signal);
      }
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
          <p className="text-lg font-medium">analyzing your inspo...</p>
          <p className="text-sm text-muted">finding every cut, the pacing, and the text style. this takes a few seconds.</p>
        </div>
      </div>
    );
  }

  const busy = phase.name === "uploading" || phase.name === "reading";

  return (
    <div className="flex flex-col gap-5">
      {!picked ? (
        <>
          <DropZone
            accept={VIDEO_ACCEPT}
            onFiles={onFiles}
            disabled={busy}
            title={phase.name === "reading" ? "checking your video..." : "upload your inspo video"}
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
            aria-label="your inspo video"
            className="aspect-[9/16] w-20 shrink-0 rounded-xl bg-black object-cover"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-sm font-medium">{picked.file.name}</p>
            <p className="text-sm text-muted">
              {picked.durationS !== null ? `${formatDuration(picked.durationS)} · ` : ""}
              {formatBytes(picked.file.size)}
            </p>
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

      <p className="text-sm text-muted">
        <span className="font-medium text-foreground">tip:</span> save the video or screen-record it, then upload it here.
      </p>

      <ConsentCheckbox checked={confirmed} onChange={setConfirmed} disabled={busy}>
        i’m using this video only as a style reference.
      </ConsentCheckbox>

      {phase.name === "uploading" && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <ProgressBar value={phase.percent} label="uploading your inspo" />
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

      {phase.name !== "uploading" && phase.name !== "failed" && (
        <button
          type="button"
          onClick={upload}
          disabled={!picked || !confirmed || busy}
          className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none`}
        >
          upload & analyze
        </button>
      )}
    </div>
  );
}
