"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ClipThumb } from "@/components/clip-thumb";
import { buttonClass } from "@/components/form";
import { SparkleIcon } from "@/components/icons";
import { OptionsFields, optionsProblem } from "@/components/options-fields";
import { ROLE_LABELS } from "@/components/shot-list";
import type { Shot } from "@/lib/processing/types";
import { activeRenderIdFrom, postJson, UploadError } from "@/lib/upload-client";
import type { OptionTextItem, VideoOptions } from "@/lib/video-options";
import { timelineShots, type TimelineShot } from "@/components/text-pieces";
import { HookCheck } from "@/components/hook-check";
import { NOTES_MAX, planKey } from "@/lib/video-options";
import { Storyboard, type StoryboardPlan } from "./storyboard";
import { piecesFromPreview } from "@/components/option-text-pieces";
import { UploadsStatus, useUploads } from "../clips/uploads-status";
import { waitForUploads } from "../clips/upload-engine";

export interface OptionClip {
  id: string;
  fileName: string | null;
  durationS: number | null;
  /** The shots it's on (one long clip can fill several). */
  shotIndexes: number[];
  previewUrl: string | null;
  thumbUrl?: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function OptionsForm({
  projectId,
  initialOptions,
  shots,
  clips: initialClips,
  oneTake = false,
  uploadedAudio = null,
  originalText = [],
}: {
  /** The original's on-screen text as pieces ("write my own" can start from it). */
  originalText?: OptionTextItem[];
  projectId: string;
  initialOptions: VideoOptions;
  shots: Shot[];
  clips: OptionClip[];
  /** One take with the pauses cut out: there are no shots to assign clips to. */
  oneTake?: boolean;
  /** The user's own audio file, if they added one on the clips step. */
  uploadedAudio?: { fileName: string } | null;
}) {
  const router = useRouter();
  const [options, setOptions] = useState(initialOptions);
  const [clips, setClips] = useState(initialClips);
  // Clips that finish uploading after this page opened (it refreshes then): add them to the list.
  const [seenClips, setSeenClips] = useState(initialClips);
  if (seenClips !== initialClips) {
    setSeenClips(initialClips);
    setClips((list) => [...list, ...initialClips.filter((c) => !list.some((x) => x.id === c.id))]);
  }
  const uploads = useUploads(projectId);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [making, setMaking] = useState(false);
  const [error, setError] = useState("");
  const first = useRef(true);
  // A storyboard made from these exact options and clips: "make my video" makes that plan.
  const [plan, setPlan] = useState<StoryboardPlan | null>(null);
  const madeFrom = JSON.stringify([planKey(options), clips.map((c) => [c.id, c.shotIndexes])]);

  // Save a moment after each change, so going back or refreshing keeps it.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (optionsProblem(options, !!uploadedAudio)) return;
    const timer = setTimeout(async () => {
      setSave("saving");
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options),
      }).catch(() => null);
      setSave(res?.ok ? "saved" : "error");
    }, 600);
    return () => clearTimeout(timer);
  }, [options, projectId, uploadedAudio]);

  async function assign(shotIndex: number, clipId: string | null) {
    const previous = clips;
    setClips((list) =>
      list.map((c) =>
        c.id === clipId
          ? { ...c, shotIndexes: [...new Set([...c.shotIndexes, shotIndex])].sort((a, b) => a - b) }
          : { ...c, shotIndexes: c.shotIndexes.filter((s) => s !== shotIndex) },
      ),
    );
    // A clip can fill several shots: picking one for this shot doesn't take it off its others.
    const current = previous.find((c) => c.shotIndexes.includes(shotIndex));
    const body = clipId
      ? { assign: { clipId, shotIndex, on: true } }
      : current
        ? { assign: { clipId: current.id, shotIndex, on: false } }
        : null;
    if (!body) return;
    const res = await fetch(`/api/projects/${projectId}/clips`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      setClips(previous);
      setError("couldn’t save that assignment. please try again.");
    }
  }

  async function make() {
    setMaking(true);
    setError("");
    try {
      // Clips still uploading from the clips step: wait for them (with their progress on the button).
      if (uploads.left > 0) {
        setWaiting(uploads.percent);
        const { failed } = await waitForUploads(projectId, (p) => setWaiting(p.percent));
        setWaiting(null);
        if (failed > 0) {
          setError(`${failed === 1 ? "a clip" : `${failed} clips`} didn’t upload. go back to retry, or tap again to make it without ${failed === 1 ? "it" : "them"}.`);
          setMaking(false);
          return;
        }
      }
      const usePlan = plan && plan.madeFrom === madeFrom ? plan.jobId : undefined;
      const { renderId } = await postJson<{ renderId: string }>(`/api/projects/${projectId}/renders`, {
        mode: "new",
        options,
        ...(usePlan ? { storyboard: usePlan } : {}),
      });
      router.push(`/projects/${projectId}/status?render=${renderId}`);
    } catch (e) {
      // A version is genuinely still being made: show its progress.
      const activeId = activeRenderIdFrom(e);
      if (activeId) return router.push(`/projects/${projectId}/status?render=${activeId}`);
      setError(e instanceof UploadError ? e.message : "something went wrong. please try again.");
      setMaking(false);
      setWaiting(null);
    }
  }

  const problem = optionsProblem(options, !!uploadedAudio);
  // The original's shots, for timing text (a one-take video's shots aren't the original's).
  const textShots: TimelineShot[] = oneTake
    ? []
    : timelineShots(
        shots.map((s) => {
          const clip = clips.find((c) => c.shotIndexes.includes(s.index));
          return { durationS: s.durationS, label: `shot ${s.index + 1}`, thumb: clip?.thumbUrl ?? null };
        }),
      );
  // No clip in yet and none uploading in this tab (e.g. the page was reopened mid-upload).
  const nothingToMake = clips.length === 0 && uploads.left === 0;

  return (
    <div className="flex flex-col gap-4">
      <UploadsStatus projectId={projectId} />
      {nothingToMake && uploads.failed === 0 && (
        <p role="alert" className="rounded-2xl border border-coral/30 bg-coral/[0.06] p-3 text-center text-sm">
          your clips aren’t uploaded yet.{" "}
          <Link href={`/projects/${projectId}/clips`} className="underline">
            add them
          </Link>{" "}
          to make your video.
        </p>
      )}
      <OptionsFields
        value={options}
        onChange={setOptions}
        uploadedAudio={uploadedAudio}
        textPieces={{
          shots: textShots,
          original: oneTake ? [] : originalText,
          // The text the preview planned (to change before it's made), while the preview still holds.
          written: plan && plan.madeFrom === madeFrom && !oneTake ? piecesFromPreview(plan.frames, plan.textItems, textShots) : [],
        }}
      />

      <details className={`group rounded-2xl border border-white/10 bg-white/[0.03] ${oneTake ? "hidden" : ""}`}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-coral sm:px-5">
          advanced: choose which clip goes in each shot (one clip can fill several)
          <span className="text-muted transition group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </summary>
        <ul className="flex flex-col gap-2 px-4 pb-4 sm:px-5">
          {shots.map((shot) => {
            const clip = clips.find((c) => c.shotIndexes.includes(shot.index));
            const alsoOn = clip ? clip.shotIndexes.filter((s) => s !== shot.index) : [];
            return (
              <li key={shot.index} className="flex items-center gap-3 rounded-xl border border-white/10 p-2">
                <ClipThumb
                  src={clip?.previewUrl ?? null}
                  image={clip?.thumbUrl ?? null}
                  durationS={null}
                  label=""
                  className="w-10 shrink-0 rounded-lg"
                />
                <label htmlFor={`assign-${shot.index}`} className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="font-medium">
                    shot {shot.index + 1}: {ROLE_LABELS[shot.role]}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {alsoOn.length
                      ? `a different part of this clip than shot${alsoOn.length > 1 ? "s" : ""} ${alsoOn.map((x) => x + 1).join(", ")}`
                      : shot.tip}
                  </span>
                </label>
                <select
                  id={`assign-${shot.index}`}
                  value={clip?.id ?? ""}
                  onChange={(e) => assign(shot.index, e.target.value || null)}
                  className="h-10 w-32 shrink-0 rounded-lg border border-white/15 bg-[#15151b] px-2 text-xs text-foreground outline-none focus-visible:border-coral sm:w-44"
                >
                  <option value="">let us pick</option>
                  {clips.map((c, i) => (
                    <option key={c.id} value={c.id}>
                      clip {i + 1}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </details>

      {oneTake && (
        <HookCheck
          projectId={projectId}
          disabled={making}
          onUseTitle={(title) =>
            setOptions((o) => {
              const line = `open with this on-screen title: "${title}"`;
              return { ...o, notes: (o.notes ? `${o.notes}\n${line}` : line).slice(0, NOTES_MAX) };
            })
          }
        />
      )}

      <Storyboard
        projectId={projectId}
        options={options}
        madeFrom={madeFrom}
        stale={!!plan && plan.madeFrom !== madeFrom}
        disabled={making || !!problem || uploads.left > 0}
        onPlan={setPlan}
      />

      <p className="min-h-5 text-center text-xs text-muted" aria-live="polite">
        {save === "saving" ? "saving…" : save === "saved" ? "all changes saved" : save === "error" ? "couldn’t save. check your connection." : ""}
      </p>
      {(problem || error) && (
        <p role="alert" className="text-center text-sm text-coral">
          {problem ?? error}
        </p>
      )}
      <div className="sticky bottom-4">
        <button
          type="button"
          onClick={make}
          disabled={making || !!problem || nothingToMake}
          className={`${buttonClass} flex h-14 items-center justify-center gap-2 text-lg disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <SparkleIcon className="size-5" />{" "}
          {waiting !== null ? `finishing your uploads · ${waiting}%` : making ? "starting…" : "make my video"}
        </button>
      </div>
    </div>
  );
}
