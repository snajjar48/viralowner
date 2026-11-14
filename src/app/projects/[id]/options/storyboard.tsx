"use client";

import { useEffect, useRef, useState } from "react";
import { AlertIcon, RefreshIcon } from "@/components/icons";
import { ProgressBar } from "@/components/progress-bar";
import { postJson, UploadError } from "@/lib/upload-client";
import type { VideoOptions } from "@/lib/video-options";

type Frame = { index: number; durationS: number; text: string; url: string };
type State =
  | { name: "idle" }
  | { name: "planning"; jobId: string | null; progress: number }
  | { name: "ready"; jobId: string; frames: Frame[] }
  | { name: "failed"; message: string };

/**
 * "Preview first": the edit planned with these options, a frame per shot with its text and where
 * the captions go, before anything is made. Free. `onPlan` gets the plan's id when it's ready (and
 * null when the options change), so "make my video" makes exactly this.
 */
export function Storyboard({
  projectId,
  options,
  madeFrom,
  stale,
  disabled,
  onPlan,
  prepare,
}: {
  projectId: string;
  options: VideoOptions;
  /** The options and clip choices right now (recorded with the plan). */
  madeFrom: string;
  /** Something changed since this storyboard was made. */
  stale: boolean;
  disabled: boolean;
  onPlan: (plan: { jobId: string; madeFrom: string } | null) => void;
  /** Saves what the plan is made from first (the prompt, for start from scratch). */
  prepare?: () => Promise<void>;
}) {
  const [state, setState] = useState<State>({ name: "idle" });
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  async function start() {
    const from = madeFrom;
    setState({ name: "planning", jobId: null, progress: 3 });
    onPlan(null);
    try {
      await prepare?.();
      const { jobId } = await postJson<{ jobId: string }>(`/api/projects/${projectId}/storyboard`, { options });
      for (let tries = 0; tries < 120 && alive.current; tries++) {
        await new Promise((r) => setTimeout(r, 2500));
        const res = await fetch(`/api/projects/${projectId}/storyboard?job=${encodeURIComponent(jobId)}`).catch(() => null);
        if (!res?.ok) continue;
        const job = (await res.json()) as { state: string; progress: number; error?: string; frames?: Frame[] };
        if (job.state === "done" && job.frames) {
          setState({ name: "ready", jobId, frames: job.frames });
          onPlan({ jobId, madeFrom: from });
          return;
        }
        if (job.state === "failed") throw new UploadError(job.error ?? "we couldn’t plan it. please try again.");
        setState({ name: "planning", jobId, progress: Math.max(5, job.progress) });
      }
      throw new UploadError("that took too long. please try again.");
    } catch (e) {
      if (alive.current) {
        setState({ name: "failed", message: e instanceof UploadError ? e.message : "we couldn’t plan it. please try again." });
      }
    }
  }

  if (state.name === "planning") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-live="polite">
        <p className="text-sm font-medium">planning your video…</p>
        <ProgressBar value={state.progress} label="planning" />
        <p className="text-xs text-muted">picking the best moment for each shot and placing your text. about a minute.</p>
      </div>
    );
  }

  if (state.name === "ready" && stale) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-center text-xs text-muted">you changed something since the preview, so we’ll plan it fresh.</p>
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 text-sm font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshIcon className="size-4" /> preview the new plan <span className="text-xs font-normal text-muted">· free</span>
        </button>
      </div>
    );
  }

  if (state.name === "ready") {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-label="storyboard">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">your storyboard</p>
          <button
            type="button"
            onClick={start}
            disabled={disabled}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-40"
          >
            <RefreshIcon className="size-3.5" /> plan it again
          </button>
        </div>
        <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {state.frames.map((f) => (
            <li key={f.index} className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage URL */}
              <img src={f.url} alt={`shot ${f.index + 1}`} className="aspect-[9/16] w-full rounded-lg bg-black object-cover" />
              <span className="text-xs text-muted tabular-nums">
                shot {f.index + 1} · {f.durationS.toFixed(1)}s
              </span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted">
          this is the plan: each shot’s moment, its text, and where your captions go (“your captions show up here” stands in
          for your words). not right? change something above and plan it again. it’s free.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {state.name === "failed" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-coral">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      )}
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 text-sm font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-50"
      >
        preview the plan first <span className="text-xs font-normal text-muted">· free</span>
      </button>
    </div>
  );
}
