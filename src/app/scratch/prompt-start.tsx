"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CategoryPicker } from "@/components/category-picker";
import { buttonClass, inputClass } from "@/components/form";
import { ArrowRightIcon } from "@/components/icons";
import type { VideoCategory } from "@/lib/categories";
import { postJson, UploadError } from "@/lib/upload-client";
import { PROMPT_MAX } from "@/lib/video-options";

/** Ideas to start from, for the kind of video picked (from what worked in each category's viral videos). */
const GENERAL_IDEAS = [
  "a fast hype promo for our new menu item, ending on the price",
  "a calm, aesthetic day-in-the-life at my studio with soft music vibes",
  "cut my talking clip into a tight 30 second tip video with no pauses",
  "a before and after reveal with a dramatic transition",
];

const IDEAS: Record<VideoCategory, string[]> = {
  food_drink: [
    "open on the pour, build the drink layer by layer, and end on the finished glass with the price",
    "a fast menu montage: one sizzling close-up per dish on the beat, ending on our best seller",
    "start with the finished dish, show how it’s made, and save the cheese pull for the big moment",
    "an asmr build of our signature item: no music, just the real sounds, under 15 seconds",
  ],
  skits: [
    "a workplace skit: put the setup on screen in the first second and end right on the punchline",
    "a rule-of-three skit: two normal answers, then the ridiculous one, under 15 seconds",
    "a pov customer skit with our own audio, starting mid-conversation, no music",
    "a silent skit with the setup as text over a trending sound, and the reveal halfway through",
  ],
  talking_head: [
    "cut my talking clip into a tight tip video: hook in the first second, no pauses, no ums",
    "a ‘3 mistakes’ video with the numbered list on screen the whole time",
    "tell my story in under 45 seconds, starting with the result first",
    "a hot take: open with ‘stop doing this’, big captions, and zoom in on the key line",
  ],
  influencer_vlog: [
    "a day in my life in under 30 seconds, quick cuts with one line of text the whole time",
    "get ready with me: show the finished look first, then the steps",
    "things i’d buy again: one product per beat with its name on screen",
    "a calm, aesthetic morning routine with soft music and no talking",
  ],
  event_recap: [
    "a 20 second recap of our launch: the crowd first, fast cuts to the beat, ending on the best moment",
    "open on the biggest moment, then ‘here’s how the night went’, ending on the group photo",
    "a wedding highlight reel: slow and warm, with the best line from the vows as the hook",
    "a pop-up recap with the date and place on screen, ending on ‘see you at the next one’",
  ],
  travel: [
    "a ‘choose your vacation’ video: one clip per spot on the beat, ending with ‘which one? comment 1–4’",
    "a room tour: door, details, bed, then the view last and held the longest",
    "open on the best view with ‘this is your sign to go to [place]’, and end back on it so it loops",
    "everything you need to see in 60 seconds: a fast highlight reel of our trip",
  ],
};

/** Step one of "start from scratch": the prompt. Creates the project, then on to the clips. */
export function PromptStart({ category: initialCategory = null }: { category?: VideoCategory | null }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<VideoCategory | null>(initialCategory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const { projectId } = await postJson<{ projectId: string }>("/api/projects", { kind: "scratch", prompt, category });
      router.push(`/projects/${projectId}/create`);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "something went wrong. please try again.");
      setBusy(false);
    }
  }

  const ideas = category ? IDEAS[category] : GENERAL_IDEAS;

  return (
    <div className="flex flex-col gap-4">
      <CategoryPicker value={category} onChange={setCategory} disabled={busy} />
      <label htmlFor="scratch-prompt" className="sr-only">
        describe your video
      </label>
      <textarea
        id="scratch-prompt"
        value={prompt}
        maxLength={PROMPT_MAX}
        rows={7}
        placeholder="e.g. a 15 second promo for my bakery’s new strawberry croffle. open on the drizzle, quick cuts to happy customers, end on the croffle with “only this weekend”. fun and playful, pop sounds on the text."
        onChange={(e) => setPrompt(e.target.value)}
        className={`${inputClass} h-auto py-3 leading-relaxed`}
      />
      <div className="flex items-start justify-between gap-3">
        <ul className="flex flex-wrap gap-2" aria-label="ideas" aria-live="polite">
          {ideas.map((idea) => (
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
