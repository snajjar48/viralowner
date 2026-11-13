"use client";

import { useRef, useState } from "react";
import { AUDIO_ACCEPT, AUDIO_MESSAGES, checkAudio, readAudioDuration, audioContentType } from "@/lib/audio-files";
import { postJson, uploadToSignedUrl, UploadError } from "@/lib/upload-client";
import { formatDuration } from "@/lib/video-options";
import { AudioRightsNotice } from "./audio-rights";
import { MusicIcon } from "./icons";
import { ProgressBar } from "./progress-bar";

export interface UploadedAudio {
  fileName: string;
  durationS: number | null;
  previewUrl: string;
}

type Phase = { name: "idle" } | { name: "uploading"; percent: number } | { name: "checking" };

/**
 * Step 2, optional: the user's own audio file (a voiceover or music) to use as
 * the video's sound. They must accept the audio rights notice first.
 */
export function AudioUploader({
  projectId,
  initial,
  onChange,
  switchNote = "you can switch back in the next step.",
}: {
  projectId: string;
  initial: UploadedAudio | null;
  /** Told when a file is added or removed. */
  onChange?: (audio: UploadedAudio | null) => void;
  switchNote?: string;
}) {
  const [audio, setAudio] = useState(initial);
  const [confirmed, setConfirmed] = useState(initial !== null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const busy = phase.name !== "idle";

  async function upload(file: File) {
    setError("");
    if (!confirmed) return setError(AUDIO_MESSAGES.confirm);
    const problem = checkAudio(file);
    if (problem) return setError(problem);
    setPhase({ name: "uploading", percent: 0 });
    try {
      const durationS = await readAudioDuration(file);
      const { upload: target } = await postJson<{ upload: { url: string; headers: Record<string, string> } }>(
        `/api/projects/${projectId}/audio`,
        {
          fileName: file.name,
          sizeBytes: file.size,
          contentType: audioContentType(file.name, file.type),
          durationS,
          rightsConfirmed: true,
        },
      );
      await uploadToSignedUrl(file, target, (percent) => setPhase({ name: "uploading", percent }));
      setPhase({ name: "checking" });
      const { audio: done } = await postJson<{ audio: UploadedAudio }>(`/api/projects/${projectId}/audio/complete`);
      setAudio(done);
      onChange?.(done);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "the upload didn’t work. please try again.");
    } finally {
      setPhase({ name: "idle" });
    }
  }

  async function remove() {
    setError("");
    const res = await fetch(`/api/projects/${projectId}/audio`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("couldn’t remove it. please try again.");
    setAudio(null);
    onChange?.(null);
  }

  return (
    <section
      aria-labelledby="audio-heading"
      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="audio-heading" className="flex items-center gap-2 text-base font-medium">
          <MusicIcon className="size-4 text-muted" /> your own audio
        </h2>
        <span className="text-xs text-muted">optional</span>
      </div>
      <p className="text-sm text-muted">
        add a voiceover or a song to use as your video’s sound. it replaces your clips’ audio, and {switchNote}
      </p>

      {audio ? (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{audio.fileName}</span>
            {audio.durationS !== null && <span className="shrink-0 text-muted">{formatDuration(audio.durationS)}</span>}
          </div>
          <audio controls preload="none" src={audio.previewUrl} className="w-full" />
          <div className="flex gap-4 text-sm">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="text-muted underline underline-offset-4 hover:text-foreground"
            >
              replace
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="text-muted underline underline-offset-4 hover:text-foreground"
            >
              remove
            </button>
          </div>
        </div>
      ) : (
        <>
          <AudioRightsNotice source="upload" checked={confirmed} onChange={setConfirmed} />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy || !confirmed}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 text-sm font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MusicIcon className="size-4" /> choose an audio file
          </button>
          <p className="text-center text-xs text-muted">MP3, M4A, AAC or WAV, up to 50 MB.</p>
        </>
      )}

      {phase.name === "uploading" && <ProgressBar value={phase.percent} label="uploading your audio" />}
      {phase.name === "checking" && <ProgressBar value={100} label="checking…" />}
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        // Reset on open, not after picking (iOS drops the file otherwise).
        onClick={(e) => {
          e.currentTarget.value = "";
        }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </section>
  );
}
