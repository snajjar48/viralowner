"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, inputClass } from "@/components/form";
import { ArrowRightIcon } from "@/components/icons";
import { postJson, UploadError } from "@/lib/upload-client";
import { PROMPT_MAX } from "@/lib/video-options";

const IDEAS = [
  "a fast hype promo for our new menu item, ending on the price",
  "a calm, aesthetic day-in-the-life at my studio with soft music vibes",
  "cut my talking clip into a tight 30 second tip video with no pauses",
  "a before and after reveal with a dramatic transition",
];

/** Step one of "start from scratch": the prompt. Creates the project, then on to the clips. */
export function PromptStart() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const { projectId } = await postJson<{ projectId: string }>("/api/projects", { kind: "scratch", prompt });
      router.push(`/projects/${projectId}/create`);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "something went wrong. please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor="scratch-prompt" className="sr-only">
        describe your video
      </label>
      <textarea
        id="scratch-prompt"
        value={prompt}
        maxLength={PROMPT_MAX}
        rows={7}
        autoFocus
        placeholder="e.g. a 15 second promo for my bakery’s new strawberry croffle. open on the drizzle, quick cuts to happy customers, end on the croffle with “only this weekend”. fun and playful, pop sounds on the text."
        onChange={(e) => setPrompt(e.target.value)}
        className={`${inputClass} h-auto py-3 leading-relaxed`}
      />
      <div className="flex items-start justify-between gap-3">
        <ul className="flex flex-wrap gap-2" aria-label="ideas">
          {IDEAS.map((idea) => (
            <li key={idea}>
              <button
                type="button"
                onClick={() => setPrompt(idea)}
                className="cursor-pointer rounded-full border border-white/15 px-3 py-1.5 text-left text-xs text-muted transition hover:border-white/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
              >
                {idea}
              </button>
            </li>
          ))}
        </ul>
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {prompt.length}/{PROMPT_MAX}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-coral">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={start}
        disabled={!prompt.trim() || busy}
        className={`${buttonClass} flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none`}
      >
        {busy ? "starting…" : "next: add your clips"} <ArrowRightIcon className="size-4" />
      </button>
    </div>
  );
}
