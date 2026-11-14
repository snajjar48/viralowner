"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioUploader, type UploadedAudio } from "@/components/audio-uploader";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { QuickAdd } from "@/components/quick-add";
import { buttonClass, inputClass } from "@/components/form";
import { SparkleIcon } from "@/components/icons";
import { OptionsFields, optionsProblem, Section } from "@/components/options-fields";
import { activeRenderIdFrom, postJson, UploadError } from "@/lib/upload-client";
import { PROMPT_MAX, type VideoOptions } from "@/lib/video-options";
import { ClipsManager, type InitialClip } from "../clips/clips-manager";
import { Storyboard } from "../options/storyboard";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * "Start from scratch": the prompt (as if talking to Claude), the clips, an optional audio
 * file and the edit options, then "make my video". Everything saves as it's changed.
 */
export function ScratchCreate({
  projectId,
  initialPrompt,
  initialOptions,
  initialClips,
  rightsConfirmed,
  initialAudio,
}: {
  projectId: string;
  initialPrompt: string;
  initialOptions: VideoOptions;
  initialClips: InitialClip[];
  rightsConfirmed: boolean;
  /** The user's own audio file, if they added one. */
  initialAudio: UploadedAudio | null;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [options, setOptions] = useState(initialOptions);
  const [audio, setAudio] = useState<{ fileName: string } | null>(initialAudio);
  const [clips, setClips] = useState({ uploaded: initialClips.filter((c) => c.status === "uploaded").length, busy: false });
  const [confirmed, setConfirmed] = useState(rightsConfirmed);
  const [save, setSave] = useState<SaveState>("idle");
  const [making, setMaking] = useState(false);
  const [error, setError] = useState("");
  const first = useRef(true);
  // A storyboard made from this exact prompt, options and clips: "make my video" makes that plan.
  const [plan, setPlan] = useState<{ jobId: string; madeFrom: string } | null>(null);
  const madeFrom = JSON.stringify([prompt.trim(), options, clips.uploaded]);

  // Save the prompt and options a moment after each change, so leaving or refreshing keeps them.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!prompt.trim() || optionsProblem(options, !!audio)) return;
    const timer = setTimeout(async () => {
      setSave("saving");
      const put = (path: string, body: unknown) =>
        fetch(`/api/projects/${projectId}/${path}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => null);
      const [a, b] = await Promise.all([put("prompt", { prompt }), put("settings", options)]);
      setSave(a?.ok && b?.ok ? "saved" : "error");
    }, 700);
    return () => clearTimeout(timer);
  }, [prompt, options, audio, projectId]);

  const onClips = useCallback((s: { uploaded: number; busy: boolean }) => setClips(s), []);

  function onAudio(next: UploadedAudio | null) {
    setAudio(next ? { fileName: next.fileName } : null);
    // A new file is what they want to hear; without one, back to the clips' own sound.
    setOptions((o) => ({
      ...o,
      music: { ...o.music, mode: next ? "upload" : o.music.mode === "upload" ? "original" : o.music.mode },
    }));
  }

  /** The prompt and clip permission, saved before anything is planned or made. */
  async function prepare() {
    const saved = await fetch(`/api/projects/${projectId}/prompt`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    }).catch(() => null);
    if (!saved?.ok) throw new UploadError("couldn’t save your description. check your connection and try again.");
    await postJson(`/api/projects/${projectId}/clips/confirm`, { rightsConfirmed: true });
  }

  async function make() {
    setMaking(true);
    setError("");
    try {
      await prepare();
      const usePlan = plan && plan.madeFrom === madeFrom ? plan.jobId : undefined;
      const { renderId } = await postJson<{ renderId: string }>(`/api/projects/${projectId}/renders`, {
        mode: "new",
        options,
        ...(usePlan ? { storyboard: usePlan } : {}),
      });
      router.push(`/projects/${projectId}/status?render=${renderId}`);
    } catch (e) {
      const activeId = activeRenderIdFrom(e);
      if (activeId) return router.push(`/projects/${projectId}/status?render=${activeId}`);
      setError(e instanceof UploadError ? e.message : "something went wrong. please try again.");
      setMaking(false);
    }
  }

  const problem = !prompt.trim()
    ? "describe the video you want."
    : !clips.uploaded
      ? "add at least one clip."
      : clips.busy
        ? "hang tight while your clips finish uploading."
        : !confirmed
          ? "confirm you have permission to use your clips."
          : optionsProblem(options, !!audio);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        <Section title="your video" icon={<SparkleIcon className="size-4 text-muted" />}>
          <label htmlFor="prompt" className="text-sm text-muted">
            tell us what you want, like you would an editor. the more you say, the closer we get.
          </label>
          <textarea
            id="prompt"
            value={prompt}
            maxLength={PROMPT_MAX}
            rows={8}
            onChange={(e) => setPrompt(e.target.value)}
            className={`${inputClass} h-auto py-3 leading-relaxed`}
          />
          <div className="flex items-start justify-between gap-3">
            <QuickAdd
              value={prompt}
              onChange={setPrompt}
              max={PROMPT_MAX}
              options={["no slow motion", "all lowercase text", "center the captions", "no emoji", "cut it to the beat", "keep it under 15 seconds"]}
            />
            <span className="shrink-0 text-xs text-muted tabular-nums">
              {prompt.length}/{PROMPT_MAX}
            </span>
          </div>
        </Section>

        <ClipsManager
          projectId={projectId}
          freeform
          onStatus={onClips}
          shots={[]}
          initialClips={initialClips}
          rightsConfirmed={rightsConfirmed}
        />
        <ConsentCheckbox checked={confirmed} onChange={setConfirmed}>
          i own or have permission to use these clips and the people in them.
        </ConsentCheckbox>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <AudioUploader
          projectId={projectId}
          initial={initialAudio}
          onChange={onAudio}
          switchNote="you can switch back under music."
        />
        <OptionsFields
          value={options}
          onChange={setOptions}
          showNotes={false}
          uploadedAudio={audio}
          variant="scratch"
        />

        <Storyboard
          projectId={projectId}
          options={options}
          madeFrom={madeFrom}
          stale={!!plan && plan.madeFrom !== madeFrom}
          disabled={making || !!problem}
          onPlan={setPlan}
          prepare={prepare}
        />

        <p className="min-h-5 text-center text-xs text-muted" aria-live="polite">
          {save === "saving" ? "saving…" : save === "saved" ? "all changes saved" : save === "error" ? "couldn’t save. check your connection." : ""}
        </p>
        {(error || (problem && clips.uploaded > 0)) && (
          <p role="alert" className="text-center text-sm text-coral">
            {error || problem}
          </p>
        )}
        <div className="sticky bottom-4">
          <button
            type="button"
            onClick={make}
            disabled={making || !!problem}
            className={`${buttonClass} flex h-14 items-center justify-center gap-2 text-lg disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <SparkleIcon className="size-5" /> {making ? "starting…" : "make my video"}
          </button>
        </div>
      </div>
    </div>
  );
}
