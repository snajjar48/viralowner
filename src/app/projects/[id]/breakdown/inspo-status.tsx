"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StateCard } from "@/components/flow-shell";
import { AlertIcon, RefreshIcon, SparkleIcon } from "@/components/icons";
import type { Inspiration } from "@/lib/projects";

type Status = Inspiration["status"];

/**
 * Shown on the breakdown page until the shot list is ready: finishes or
 * retries the analysis, and polls while it's running.
 */
export function InspoStatus({
  projectId,
  status: initial,
  error: initialError,
}: {
  projectId: string;
  status: Status;
  error: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initial);
  const [error, setError] = useState(initialError);

  // Asks the server to finish (or check on) the analysis. Only sets state
  // after the response, so it's safe to call from effects.
  const check = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/inspo/complete`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.status === "ready") return router.refresh();
      if (data.status === "failed" || !res.ok) {
        setStatus("failed");
        setError(data.error ?? "something went wrong. please try again.");
        return;
      }
      setStatus(data.status ?? "analyzing"); // another request is analyzing it; keep polling
    } catch {
      setStatus("failed");
      setError("network error. check your connection and try again.");
    }
  }, [projectId, router]);

  // "try again" just leaves the failed state; the effect below does the work.
  function retry() {
    setError(null);
    setStatus("analyzing");
  }

  // Until it's ready: check right away (this also resumes an analysis that
  // stopped when the page was closed), then every few seconds.
  useEffect(() => {
    if (status === "failed") return;
    const first = setTimeout(check, 0);
    const timer = setInterval(check, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [status, check]);

  if (status === "failed") {
    return (
      <StateCard tone="error" icon={<AlertIcon className="size-8 text-coral" />} title="we hit a snag with your inspo">
        <p className="text-sm text-muted">{error ?? "something went wrong. please try again."}</p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
          >
            <RefreshIcon className="size-4" /> try again
          </button>
          <Link
            href={`/projects/${projectId}/inspo`}
            className="inline-flex h-10 items-center rounded-full px-4 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
          >
            upload a different video
          </Link>
        </div>
      </StateCard>
    );
  }

  return (
    <div role="status">
      <StateCard
        icon={
          <span className="flex size-14 items-center justify-center rounded-full bg-linear-to-r from-violet to-coral text-white motion-safe:animate-pulse">
            <SparkleIcon className="size-6" />
          </span>
        }
        title="analyzing your inspo..."
      >
        <p className="text-sm text-muted">finding every cut, the pacing, and the text style.</p>
      </StateCard>
    </div>
  );
}
