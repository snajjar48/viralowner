"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Fewer or more shots than the inspo: the shot list below (and the video) follows. */
export function ShotCount({ projectId, count, min, max, inspo, locked }: { projectId: string; count: number; min: number; max: number; inspo: number; locked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(n: number) {
    if (busy || n === count || n < min || n > max) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/inspo/shots`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: n }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      setError(data?.error ?? "couldn’t change it. please try again.");
    } else {
      router.refresh();
    }
    setBusy(false);
  }

  const step =
    "flex size-10 cursor-pointer items-center justify-center rounded-full border border-white/15 text-lg hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section aria-labelledby="count-heading" className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 id="count-heading" className="font-medium">
            number of shots
          </h2>
          <p className="text-xs text-muted">
            {count === inspo ? "same as the inspo." : `the inspo has ${inspo}. `}
            {count < inspo && "shots next to each other are joined, so you film less."}
            {count > inspo && "long shots are split, for a faster edit."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" aria-label="fewer shots" disabled={locked || busy || count <= min} onClick={() => set(count - 1)} className={step}>
            −
          </button>
          <output aria-live="polite" className="w-8 text-center text-lg font-medium tabular-nums">
            {count}
          </output>
          <button type="button" aria-label="more shots" disabled={locked || busy || count >= max} onClick={() => set(count + 1)} className={step}>
            +
          </button>
        </div>
      </div>
      {count !== inspo && !locked && (
        <button type="button" onClick={() => set(inspo)} disabled={busy} className="w-fit cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-foreground">
          back to the inspo’s {inspo}
        </button>
      )}
      {locked && <p className="text-xs text-muted">this video has versions already. start a new project to change the number of shots.</p>}
      {error && <p className="text-sm text-coral">{error}</p>}
    </section>
  );
}
