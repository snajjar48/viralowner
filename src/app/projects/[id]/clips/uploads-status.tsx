"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { ProgressBar } from "@/components/progress-bar";
import { runningEngine, uploadProgress, type Item } from "./upload-engine";

const noItems: Item[] = [];
const noSubscribe = () => () => {};

/** The project's uploads as they go (an empty list when none are running in this tab). */
export function useUploads(projectId: string) {
  const engine = runningEngine(projectId);
  const items = useSyncExternalStore(
    engine?.subscribe ?? noSubscribe,
    () => engine?.items ?? noItems,
    () => noItems,
  );
  return uploadProgress(items);
}

/**
 * On a step after the clips: the clips still uploading from the clips step (they keep going), and
 * the page refreshes when they're all in, so it shows them.
 */
export function UploadsStatus({ projectId }: { projectId: string }) {
  const router = useRouter();
  const p = useUploads(projectId);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (p.left > 0) wasBusy.current = true;
    else if (wasBusy.current) {
      wasBusy.current = false;
      router.refresh(); // the clips that just finished
    }
  }, [p.left, router]);

  if (p.left > 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <ProgressBar
          value={p.percent}
          label={`your clips are still uploading · ${p.left} of ${p.total} left. keep going, we’ll wait for them.`}
        />
      </div>
    );
  }
  if (p.failed > 0) {
    return (
      <p role="alert" className="rounded-2xl border border-coral/30 bg-coral/[0.06] p-3 text-center text-sm">
        {p.failed === 1 ? "a clip" : `${p.failed} clips`} didn’t upload.{" "}
        <Link href={`/projects/${projectId}/clips`} className="underline">
          go back to retry
        </Link>{" "}
        or make the video without {p.failed === 1 ? "it" : "them"}.
      </p>
    );
  }
  return null;
}
