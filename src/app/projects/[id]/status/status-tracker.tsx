"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageTitle, StateCard } from "@/components/flow-shell";
import { AlertIcon, CheckIcon, RefreshIcon } from "@/components/icons";
import { ProgressBar } from "@/components/progress-bar";
import { JOB_STAGES, type JobStage } from "@/lib/processing/types";

const STAGE_COPY: Record<JobStage, { title: string; detail: string }> = {
  analyzing: { title: "analyzing", detail: "studying your inspo’s timing and style" },
  matching: { title: "matching", detail: "picking the best moment from each clip" },
  editing: { title: "editing", detail: "cutting to the pace, adding text and captions" },
  finishing: { title: "finishing", detail: "exporting in full hd, 1080×1920" },
};

// "Start from scratch": Claude watches the clips and plans the edit from the prompt.
const SCRATCH_STAGE_COPY: Record<JobStage, { title: string; detail: string }> = {
  analyzing: { title: "watching", detail: "watching your clips and listening to what’s said" },
  matching: { title: "planning", detail: "planning your edit from your description" },
  editing: { title: "editing", detail: "cutting it together with text, effects and sounds" },
  finishing: { title: "finishing", detail: "exporting in full hd, 1080×1920" },
};

interface RenderState {
  version: number;
  status: "queued" | "processing" | "done" | "failed";
  stage: JobStage | null;
  progress: number;
  error: string | null;
}

const POLL_MS = 2500;

export function StatusTracker({
  projectId,
  renderId,
  initial,
  scratch = false,
}: {
  projectId: string;
  renderId: string;
  initial: RenderState;
  /** A "start from scratch" video (different stage descriptions). */
  scratch?: boolean;
}) {
  const stageCopy = scratch ? SCRATCH_STAGE_COPY : STAGE_COPY;
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const [checkError, setCheckError] = useState<"network" | "server" | null>(null);

  // Poll while the video is being made.
  useEffect(() => {
    if (state.status === "done" || state.status === "failed") return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/renders/${renderId}`, { cache: "no-store" }).catch(() => null);
        if (!res) throw new Error("network");
        if (!res.ok) throw new Error("server");
        const next = (await res.json()) as RenderState;
        if (stopped) return;
        setCheckError(null);
        setState(next);
        if (next.status === "done") router.replace(`/projects/${projectId}/preview?v=${next.version}`);
      } catch (error) {
        if (!stopped) setCheckError(error instanceof Error && error.message === "network" ? "network" : "server");
      }
    };
    const first = setTimeout(tick, 300);
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [state.status, projectId, renderId, router]);

  async function retry() {
    setRetrying(true);
    const res = await fetch(`/api/projects/${projectId}/renders/${renderId}/retry`, { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setRetrying(false);
    if (!res?.ok) {
      setState((s) => ({ ...s, error: data?.error ?? "we couldn’t restart it. please try again." }));
      return;
    }
    setState((s) => ({ ...s, status: "processing", stage: "analyzing", progress: 0, error: null }));
  }

  if (state.status === "failed") {
    return (
      <div className="flex flex-col gap-6">
        <PageTitle title="that didn’t work out" />
        <StateCard tone="error" icon={<AlertIcon className="size-8 text-coral" />} title={`version ${state.version} didn’t finish`}>
          <p className="text-sm text-muted">{state.error ?? "something went wrong while making your video."}</p>
          <p className="text-sm text-muted">your clips and settings are saved. trying again usually fixes it.</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-linear-to-r from-violet to-coral px-5 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-60"
            >
              <RefreshIcon className="size-4" /> {retrying ? "restarting…" : "try again"}
            </button>
            <Link
              href={`/projects/${projectId}/options`}
              className="inline-flex h-11 items-center rounded-full px-4 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
            >
              change options
            </Link>
          </div>
        </StateCard>
      </div>
    );
  }

  const activeIndex = state.stage ? JOB_STAGES.indexOf(state.stage) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={state.version > 1 ? `making version ${state.version}...` : "making your video..."}
        subtitle="this usually takes less than a minute."
      />
      <div className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <ProgressBar value={state.status === "queued" ? 0 : state.progress} label={state.status === "queued" ? "waiting to start" : "progress"} />
        <ol className="flex flex-col gap-3" aria-label="stages">
          {JOB_STAGES.map((stage, i) => {
            const done = i < activeIndex;
            const active = i === activeIndex && state.status !== "queued";
            return (
              <li key={stage} className="flex items-center gap-3" aria-current={active ? "step" : undefined}>
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs ${
                    done
                      ? "bg-white/15 text-foreground"
                      : active
                        ? "bg-linear-to-r from-violet to-coral text-white"
                        : "border border-white/15 text-muted"
                  }`}
                >
                  {done ? (
                    <CheckIcon className="size-4" />
                  ) : active ? (
                    <span className="size-3 rounded-full border-2 border-white border-t-transparent motion-safe:animate-spin" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="flex flex-col">
                  <span className={`text-sm font-medium ${done || active ? "text-foreground" : "text-muted"}`}>
                    {stageCopy[stage].title}
                    {done && <span className="sr-only"> (done)</span>}
                  </span>
                  <span className="text-xs text-muted">{stageCopy[stage].detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {checkError && (
        <p role="status" className="text-center text-sm text-muted">
          {checkError === "network"
            ? "having trouble reaching us. we’ll keep trying."
            : "something’s off on our side while checking your video. we’ll keep trying."}
        </p>
      )}
      <p className="text-center text-sm text-muted">you can leave this page. we’ll email you when your video is ready.</p>
    </div>
  );
}
