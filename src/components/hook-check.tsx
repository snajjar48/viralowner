"use client";

import { useEffect, useRef, useState } from "react";
import { SparkleIcon } from "./icons";
import { postJson, UploadError } from "@/lib/upload-client";

type Result = { line: string; verdict: "strong" | "okay" | "weak"; has: string[]; why: string; rewrites: string[]; title: string };
type State = { name: "idle" } | { name: "checking" } | { name: "done"; result: Result } | { name: "failed"; message: string };

const VERDICTS: Record<Result["verdict"], { label: string; tone: string }> = {
  strong: { label: "strong hook", tone: "bg-emerald-400/15 text-emerald-300" },
  okay: { label: "okay hook", tone: "bg-amber-300/15 text-amber-200" },
  weak: { label: "weak hook", tone: "bg-coral/15 text-coral" },
};

const HAS_LABELS: Record<string, string> = {
  number: "a number",
  call_out: "who it’s for",
  result: "a result",
  question: "a question",
  bold_claim: "a bold claim",
};

/**
 * "Check my hook": the first thing said in the clips, judged the way viral talking videos open,
 * with stronger first lines to film and an opening title the user can use. Free.
 */
export function HookCheck({
  projectId,
  disabled,
  onUseTitle,
}: {
  projectId: string;
  disabled: boolean;
  /** Adds the suggested opening title to the user's requests. */
  onUseTitle: (title: string) => void;
}) {
  const [state, setState] = useState<State>({ name: "idle" });
  const [used, setUsed] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  async function check() {
    setState({ name: "checking" });
    setUsed(false);
    try {
      const { jobId } = await postJson<{ jobId: string }>(`/api/projects/${projectId}/hook`, {});
      for (let tries = 0; tries < 60 && alive.current; tries++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/projects/${projectId}/hook?job=${encodeURIComponent(jobId)}`).catch(() => null);
        if (!res?.ok) continue;
        const job = (await res.json()) as { state: string; result?: Result; error?: string };
        if (job.state === "done" && job.result) return setState({ name: "done", result: job.result });
        if (job.state === "failed") throw new UploadError(job.error ?? "we couldn’t check your hook. please try again.");
      }
      throw new UploadError("that took too long. please try again.");
    } catch (e) {
      if (alive.current) {
        setState({ name: "failed", message: e instanceof UploadError ? e.message : "we couldn’t check your hook. please try again." });
      }
    }
  }

  if (state.name === "done") {
    const r = state.result;
    const v = VERDICTS[r.verdict];
    const missing = Object.keys(HAS_LABELS).filter((k) => !r.has.includes(k));
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-label="hook check">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">your hook</p>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${v.tone}`}>{v.label}</span>
        </div>
        <p className="text-sm">“{r.line}”</p>
        <p className="text-sm text-pretty text-muted">{r.why}</p>
        {r.verdict !== "strong" && missing.length > 0 && (
          <p className="text-xs text-muted">
            the hooks that go viral usually have at least one of: {missing.map((k) => HAS_LABELS[k]).join(", ")}.
          </p>
        )}
        {r.rewrites.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">try saying instead</p>
            <ul className="flex flex-col gap-1.5">
              {r.rewrites.map((x) => (
                <li key={x} className="rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
                  “{x}”
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">film one of these as your first line, start talking the second you hit record, and re-upload that clip.</p>
          </div>
        )}
        {r.title && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-3">
            <span className="text-sm">
              <span className="text-muted">opening title: </span>“{r.title}”
            </span>
            <button
              type="button"
              disabled={used}
              onClick={() => {
                onUseTitle(r.title);
                setUsed(true);
              }}
              className="h-9 cursor-pointer rounded-full bg-white/10 px-3.5 text-xs font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-60"
            >
              {used ? "added ✓" : "use this title"}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={check}
          className="self-start text-xs text-muted underline underline-offset-4 hover:text-foreground"
        >
          check again
        </button>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {state.name === "failed" && (
        <p role="alert" className="text-sm text-coral">
          {state.message}
        </p>
      )}
      <button
        type="button"
        onClick={check}
        disabled={disabled || state.name === "checking"}
        className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 text-sm font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-50"
      >
        <SparkleIcon className="size-4" />
        {state.name === "checking" ? "listening to your first line…" : "check my hook"}
        <span className="text-xs font-normal text-muted">· free</span>
      </button>
    </div>
  );
}
