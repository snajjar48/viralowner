"use client";

import type { Shot } from "@/lib/processing/types";
import { CheckIcon } from "./icons";

export const ROLE_LABELS: Record<Shot["role"], string> = {
  hook: "hook",
  setup: "setup",
  build: "build-up",
  reveal: "reveal",
  payoff: "payoff",
  "b-roll": "b-roll",
  cta: "call to action",
};

export function shotSeconds(s: number) {
  return s < 1.5 ? "about 1 second" : `about ${Math.round(s)} seconds`;
}

/**
 * The numbered shot list. Plain list on the breakdown page; with `covered`
 * it becomes a checklist, and with `onSelect` each shot is a button (used to
 * assign the selected clip to a shot).
 */
export function ShotList({
  shots,
  covered,
  selected,
  onSelect,
  compact = false,
}: {
  shots: Shot[];
  /** Shot indexes that have a clip assigned (shows a check). */
  covered?: Set<number>;
  selected?: number | null;
  onSelect?: (shotIndex: number) => void;
  compact?: boolean;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {shots.map((shot) => {
        const isCovered = covered?.has(shot.index) ?? false;
        const body = (
          <>
            <span
              aria-hidden="true"
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                isCovered
                  ? "bg-linear-to-r from-violet to-coral text-white"
                  : "border border-white/15 text-muted"
              }`}
            >
              {isCovered ? <CheckIcon className="size-3.5" /> : shot.index + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 text-left">
              <span className="text-sm font-medium">
                shot {shot.index + 1}: {ROLE_LABELS[shot.role]}
                <span className="font-normal text-muted"> · {shotSeconds(shot.durationS)}</span>
              </span>
              {!compact && <span className="text-sm text-muted">{shot.tip}.</span>}
            </span>
            {covered && <span className="sr-only">{isCovered ? "(has a clip)" : "(no clip yet)"}</span>}
          </>
        );
        const base = `flex w-full items-start gap-3 rounded-xl border p-3 transition ${
          selected === shot.index ? "border-coral/60 bg-coral/10" : "border-white/10 bg-white/[0.03]"
        }`;
        return (
          <li key={shot.index}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(shot.index)}
                aria-pressed={selected === shot.index}
                className={`${base} cursor-pointer hover:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral`}
              >
                {body}
              </button>
            ) : (
              <div className={base}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
