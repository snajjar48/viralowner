"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ClipThumb } from "@/components/clip-thumb";
import { buttonClass } from "@/components/form";
import { SparkleIcon } from "@/components/icons";
import { OptionsFields, optionsProblem } from "@/components/options-fields";
import { ROLE_LABELS } from "@/components/shot-list";
import type { Shot } from "@/lib/processing/types";
import { postJson, UploadError } from "@/lib/upload-client";
import type { VideoOptions } from "@/lib/video-options";

export interface OptionClip {
  id: string;
  fileName: string | null;
  durationS: number | null;
  shotIndex: number | null;
  previewUrl: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function OptionsForm({
  projectId,
  initialOptions,
  shots,
  clips: initialClips,
}: {
  projectId: string;
  initialOptions: VideoOptions;
  shots: Shot[];
  clips: OptionClip[];
}) {
  const router = useRouter();
  const [options, setOptions] = useState(initialOptions);
  const [clips, setClips] = useState(initialClips);
  const [save, setSave] = useState<SaveState>("idle");
  const [making, setMaking] = useState(false);
  const [error, setError] = useState("");
  const first = useRef(true);

  // Save a moment after each change, so going back or refreshing keeps it.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (optionsProblem(options)) return;
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
  }, [options, projectId]);

  async function assign(shotIndex: number, clipId: string | null) {
    const previous = clips;
    setClips((list) =>
      list.map((c) =>
        c.id === clipId ? { ...c, shotIndex } : c.shotIndex === shotIndex ? { ...c, shotIndex: null } : c,
      ),
    );
    const current = previous.find((c) => c.shotIndex === shotIndex);
    const body = clipId ? { assign: { clipId, shotIndex } } : current ? { assign: { clipId: current.id, shotIndex: null } } : null;
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
      const { renderId } = await postJson<{ renderId: string }>(`/api/projects/${projectId}/renders`, {
        mode: "new",
        options,
      });
      router.push(`/projects/${projectId}/status?render=${renderId}`);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "something went wrong. please try again.");
      setMaking(false);
    }
  }

  const problem = optionsProblem(options);

  return (
    <div className="flex flex-col gap-4">
      <OptionsFields value={options} onChange={setOptions} />

      <details className="group rounded-2xl border border-white/10 bg-white/[0.03]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-coral sm:px-5">
          advanced: choose which clip goes in each shot
          <span className="text-muted transition group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </summary>
        <ul className="flex flex-col gap-2 px-4 pb-4 sm:px-5">
          {shots.map((shot) => {
            const clip = clips.find((c) => c.shotIndex === shot.index);
            return (
              <li key={shot.index} className="flex items-center gap-3 rounded-xl border border-white/10 p-2">
                <ClipThumb src={clip?.previewUrl ?? null} durationS={null} label="" className="w-10 shrink-0 rounded-lg" />
                <label htmlFor={`assign-${shot.index}`} className="flex min-w-0 flex-1 flex-col text-sm">
                  <span className="font-medium">
                    shot {shot.index + 1}: {ROLE_LABELS[shot.role]}
                  </span>
                  <span className="truncate text-xs text-muted">{shot.tip}</span>
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
          disabled={making || !!problem}
          className={`${buttonClass} flex h-14 items-center justify-center gap-2 text-lg disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <SparkleIcon className="size-5" /> {making ? "starting…" : "make my video"}
        </button>
      </div>
    </div>
  );
}
