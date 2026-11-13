"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageTitle } from "@/components/flow-shell";
import { buttonClass, inputClass } from "@/components/form";
import { ArrowRightIcon, RefreshIcon, SparkleIcon } from "@/components/icons";
import { OptionsFields, optionsProblem, Section } from "@/components/options-fields";
import { ROLE_LABELS } from "@/components/shot-list";
import { VideoPlayer } from "@/components/video-player";
import type { RenderSettings, Shot, ShotEdit } from "@/lib/processing/types";
import { activeRenderIdFrom, postJson, UploadError } from "@/lib/upload-client";
import { formatDuration, REQUEST_MAX } from "@/lib/video-options";

interface EditorClip {
  id: string;
  label: string;
  durationS: number;
  previewUrl: string;
}

const secondaryButton =
  "inline-flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 text-sm font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-50";

export function PreviewEditor({
  projectId,
  versions,
  current,
  inProgress,
  failedLatest,
  shots,
  clips,
  oneTake = false,
  uploadedAudio = null,
  changes,
  variant = "inspo",
  prompt,
}: {
  projectId: string;
  versions: number[];
  /** `shots`: what this version actually used (the engine's picks filled in). */
  current: { version: number; videoUrl: string; settings: RenderSettings; shots: ShotEdit[]; note: string | null };
  inProgress: { id: string; version: number } | null;
  failedLatest: { id: string; version: number } | null;
  shots: Shot[];
  clips: EditorClip[];
  /** Made from one take with the pauses cut out: no per-shot clip choices. */
  oneTake?: boolean;
  uploadedAudio?: { fileName: string } | null;
  /** Changes (new versions) this video has left, and whether the account has a plan. */
  changes: { left: number | null; subscribed: boolean };
  /** "scratch": a "start from scratch" video. */
  variant?: "inspo" | "scratch";
  /** What the user described ("start from scratch"), shown for reference. */
  prompt?: string;
}) {
  const router = useRouter();
  const clipIds = new Set(clips.map((c) => c.id));
  const initialShots: ShotEdit[] = shots.map(
    (s) =>
      current.shots.find((e) => e.shotIndex === s.index && (!e.clipId || clipIds.has(e.clipId))) ?? {
        shotIndex: s.index,
        clipId: null,
        trimStartS: null,
        trimEndS: null,
      },
  );
  const [options, setOptions] = useState(current.settings.options);
  const [shotEdits, setShotEdits] = useState(initialShots);
  const [busy, setBusy] = useState<"apply" | "regenerate" | null>(null);
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");

  const dirty =
    JSON.stringify(options) !== JSON.stringify(current.settings.options) ||
    JSON.stringify(shotEdits) !== JSON.stringify(initialShots);
  const trimProblem = shotEdits.find((e) => {
    if (!e.clipId || (e.trimStartS === null && e.trimEndS === null)) return false;
    const d = clips.find((c) => c.id === e.clipId)?.durationS ?? 0;
    const start = e.trimStartS ?? 0;
    const end = e.trimEndS ?? d;
    return start < 0 || end > d + 0.05 || end - start < 0.3;
  });
  const problem =
    optionsProblem(options, !!uploadedAudio) ??
    (trimProblem ? `shot ${trimProblem.shotIndex + 1}: the trim needs to be at least 0.3s and inside the clip.` : null);

  const setShot = (index: number, patch: Partial<ShotEdit>) =>
    setShotEdits((list) => list.map((e) => (e.shotIndex === index ? { ...e, ...patch } : e)));

  async function run(kind: "apply" | "regenerate") {
    setBusy(kind);
    setError("");
    try {
      const body =
        kind === "apply"
          ? { mode: "edit", options, shots: shotEdits, fromVersion: current.version, request: request.trim() || undefined }
          : { mode: "regenerate", fromVersion: current.version };
      const { renderId } = await postJson<{ renderId: string }>(`/api/projects/${projectId}/renders`, body);
      router.push(`/projects/${projectId}/status?render=${renderId}`);
    } catch (e) {
      // A version is genuinely still being made: show its progress.
      const activeId = activeRenderIdFrom(e);
      if (activeId) return router.push(`/projects/${projectId}/status?render=${activeId}`);
      setError(e instanceof UploadError ? e.message : "something went wrong. please try again.");
      setBusy(null);
    }
  }

  const outOfChanges = changes.left !== null && changes.left <= 0;
  const locked = !!inProgress || busy !== null || outOfChanges;
  const asking = request.trim().length > 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,auto)_1fr] lg:items-start">
      <div className="flex flex-col items-center gap-4 lg:sticky lg:top-6">
        <VideoPlayer src={current.videoUrl} size="fit" label={`your video, version ${current.version}`} />

        {versions.length > 1 && (
          <nav aria-label="versions" className="flex max-w-full flex-wrap justify-center gap-2">
            {versions.map((v) => (
              <Link
                key={v}
                href={`/projects/${projectId}/preview?v=${v}`}
                scroll={false}
                aria-current={v === current.version ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm transition focus-visible:outline-2 focus-visible:outline-coral ${
                  v === current.version
                    ? "bg-linear-to-r from-violet to-coral font-medium text-white"
                    : "border border-white/15 text-muted hover:text-foreground"
                }`}
              >
                version {v}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex w-full max-w-sm flex-col gap-2">
          <Link
            href={`/projects/${projectId}/export?v=${current.version}`}
            className={`${buttonClass} flex items-center justify-center gap-2`}
          >
            download <ArrowRightIcon className="size-4" />
          </Link>
          <button type="button" onClick={() => run("regenerate")} disabled={locked} className={secondaryButton}>
            <RefreshIcon className="size-4" /> {busy === "regenerate" ? "starting…" : "regenerate"}
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <PageTitle
          title={versions.length > 1 ? `version ${current.version}` : "your video is ready"}
          subtitle="happy with it? download it. want changes? edit below and we’ll make a new version. your old versions stay here."
        />

        {inProgress && (
          <Link
            href={`/projects/${projectId}/status?render=${inProgress.id}`}
            className="rounded-xl border border-violet/40 bg-violet/10 p-3 text-sm hover:bg-violet/15 focus-visible:outline-2 focus-visible:outline-coral"
          >
            version {inProgress.version} is being made right now. <span className="underline underline-offset-4">see progress</span>
          </Link>
        )}
        {failedLatest && !inProgress && (
          <Link
            href={`/projects/${projectId}/status?render=${failedLatest.id}`}
            className="rounded-xl border border-coral/30 bg-coral/[0.06] p-3 text-sm hover:bg-coral/10 focus-visible:outline-2 focus-visible:outline-coral"
          >
            version {failedLatest.version} didn’t finish. <span className="underline underline-offset-4">try it again</span>
          </Link>
        )}

        {current.settings.request && (
          <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
            <p>
              <span className="text-muted">you asked: </span>
              {current.settings.request}
            </p>
            {current.note && (
              <p>
                <span className="text-muted">what we changed: </span>
                {current.note}
              </p>
            )}
          </div>
        )}

        {prompt && (
          <details className="group rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-muted focus-visible:outline-2 focus-visible:outline-coral">
              what you asked for
              <span className="transition group-open:rotate-180" aria-hidden="true">
                ▾
              </span>
            </summary>
            <p className="mt-2 whitespace-pre-wrap">{prompt}</p>
          </details>
        )}

        <ChangesLeft changes={changes} />

        <Section title="request a change" icon={<SparkleIcon className="size-4 text-muted" />}>
          <label htmlFor="change-request" className="text-sm text-muted">
            {variant === "scratch"
              ? "tell us what to change, in your own words: anything from the cuts and order to the words, effects and sounds. we’ll make a new version."
              : "tell us what to change, in your own words. we’ll make a new version."}
          </label>
          <textarea
            id="change-request"
            value={request}
            maxLength={REQUEST_MAX}
            rows={3}
            placeholder={
              variant === "scratch"
                ? "e.g. make it faster, open on the finished pizza, and add a fire transition before the reveal"
                : "e.g. shrink the words and move them so they aren’t covering any faces"
            }
            onChange={(e) => setRequest(e.target.value)}
            className={`${inputClass} h-auto py-3`}
          />
          <span className="self-end text-xs text-muted tabular-nums">
            {request.length}/{REQUEST_MAX}
          </span>
        </Section>

        {oneTake && (
          <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-muted">
            this version is cut from your take, with the pauses, retakes and “um”s taken out. want it cut
            differently? tap regenerate.
          </p>
        )}

        <Section title="shots" className={oneTake ? "hidden" : undefined}>
          <ol className="flex flex-col gap-2">
            {shots.map((shot) => {
              const edit = shotEdits[shot.index];
              const clip = clips.find((c) => c.id === edit.clipId);
              return (
                <li key={shot.index} className="flex flex-col gap-2 rounded-xl border border-white/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor={`clip-${shot.index}`} className="text-sm font-medium">
                      shot {shot.index + 1}: {ROLE_LABELS[shot.role]}
                    </label>
                    <select
                      id={`clip-${shot.index}`}
                      value={edit.clipId ?? ""}
                      onChange={(e) =>
                        setShot(shot.index, { clipId: e.target.value || null, trimStartS: null, trimEndS: null })
                      }
                      className="h-10 w-36 rounded-lg border border-white/15 bg-[#15151b] px-2 text-sm text-foreground outline-none focus-visible:border-coral"
                    >
                      <option value="">let us pick</option>
                      {clips.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label} · {formatDuration(c.durationS)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {clip && (
                    <fieldset className="flex items-end gap-2">
                      <legend className="sr-only">trim shot {shot.index + 1}</legend>
                      <TrimInput
                        id={`start-${shot.index}`}
                        label="start (s)"
                        value={edit.trimStartS}
                        placeholder="0"
                        max={clip.durationS}
                        onChange={(v) => setShot(shot.index, { trimStartS: v })}
                      />
                      <TrimInput
                        id={`end-${shot.index}`}
                        label="end (s)"
                        value={edit.trimEndS}
                        placeholder={clip.durationS.toFixed(1)}
                        max={clip.durationS}
                        onChange={(v) => setShot(shot.index, { trimEndS: v })}
                      />
                      <span className="pb-3 text-xs text-muted">of {formatDuration(clip.durationS)}</span>
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ol>
        </Section>

        <OptionsFields
          value={options}
          onChange={setOptions}
          showNotes={false}
          uploadedAudio={uploadedAudio}
          variant={variant}
        />

        {(problem || error) && (
          <p role="alert" className="text-center text-sm text-coral">
            {problem ?? error}
          </p>
        )}
        <div className="sticky bottom-4">
          <button
            type="button"
            onClick={() => run("apply")}
            disabled={(!dirty && !asking) || !!problem || locked}
            className={`${buttonClass} flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none`}
          >
            <SparkleIcon className="size-4" />
            {busy === "apply"
              ? "starting…"
              : dirty || asking
                ? "apply changes (makes a new version)"
                : "make a change to apply it"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangesLeft({ changes }: { changes: { left: number | null; subscribed: boolean } }) {
  if (changes.left === null) return null;
  if (changes.left > 0) {
    return (
      <p className="text-sm text-muted">
        {changes.left} {changes.left === 1 ? "change" : "changes"} left on this video. each change or regenerate
        makes a new version.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
      {changes.subscribed ? (
        <p className="text-muted">you’ve used all the changes for this video. you can still download any version.</p>
      ) : (
        <>
          <p className="text-muted">
            you’ve used the free change on this video. you can still download it. to keep editing, choose a plan.
          </p>
          <Link href="/plans" className="self-start text-foreground underline underline-offset-4">
            choose a plan
          </Link>
        </>
      )}
    </div>
  );
}

function TrimInput({
  id,
  label,
  value,
  placeholder,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  placeholder: string;
  max: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={0.1}
        min={0}
        max={max}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={`${inputClass} h-10 px-3 text-sm`}
      />
    </div>
  );
}
