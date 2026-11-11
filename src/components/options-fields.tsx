"use client";

import { useId, type ReactNode } from "react";
import { TEXT_MAX, type MusicMode, type VideoOptions } from "@/lib/video-options";
import { CaptionStylePicker, Toggle } from "./caption-styles";
import { MusicIcon, TextIcon } from "./icons";
import { inputClass } from "./form";
import { TrackPicker } from "./track-picker";

export function Section({ title, icon, children, aside }: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-medium">
          {icon}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Choice({
  name,
  checked,
  onChange,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-coral ${
        checked ? "border-coral/60 bg-coral/10" : "border-white/10 hover:border-white/25"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-coral" : "border-white/30"
        }`}
      >
        {checked && <span className="size-2.5 rounded-full bg-linear-to-r from-violet to-coral" />}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

const MUSIC_CHOICES: { mode: MusicMode; title: string; description: string }[] = [
  { mode: "track", title: "pick a track", description: "licensed music, safe to post anywhere" },
  { mode: "original", title: "keep my clips’ original audio", description: "your voice and sounds, as filmed" },
  { mode: "none", title: "no music", description: "add a trending sound in the app when you post" },
];

/** On-screen text, music and captions. Used on step 3 and in the preview editor. */
export function OptionsFields({ value, onChange }: { value: VideoOptions; onChange: (next: VideoOptions) => void }) {
  const id = useId();
  const set = (patch: Partial<VideoOptions>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <Section title="on-screen text" icon={<TextIcon className="size-4 text-muted" />}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice
            name={`${id}-text`}
            checked={value.text.mode === "match"}
            onChange={() => set({ text: { ...value.text, mode: "match" } })}
            title="match the inspo"
            description="same style and placement, your words"
          />
          <Choice
            name={`${id}-text`}
            checked={value.text.mode === "custom"}
            onChange={() => set({ text: { ...value.text, mode: "custom" } })}
            title="write my own"
            description="your exact wording"
          />
        </div>
        {value.text.mode === "custom" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-custom`} className="text-sm text-muted">
              your text or caption wording
            </label>
            <textarea
              id={`${id}-custom`}
              value={value.text.custom}
              maxLength={TEXT_MAX}
              rows={3}
              placeholder="e.g. 3 things nobody tells you about opening a café"
              onChange={(e) => set({ text: { mode: "custom", custom: e.target.value } })}
              className={`${inputClass} h-auto py-3`}
            />
            <span className="self-end text-xs text-muted tabular-nums">
              {value.text.custom.length}/{TEXT_MAX}
            </span>
          </div>
        )}
      </Section>

      <Section title="music" icon={<MusicIcon className="size-4 text-muted" />}>
        <div className="flex flex-col gap-2">
          {MUSIC_CHOICES.map((c) => (
            <Choice
              key={c.mode}
              name={`${id}-music`}
              checked={value.music.mode === c.mode}
              onChange={() => set({ music: { mode: c.mode, trackId: value.music.trackId } })}
              title={c.title}
              description={c.description}
            />
          ))}
        </div>
        {value.music.mode === "track" && (
          <TrackPicker value={value.music.trackId} onChange={(trackId) => set({ music: { mode: "track", trackId } })} />
        )}
      </Section>

      <Section
        title="captions"
        aside={
          <Toggle
            checked={value.captions.enabled}
            onChange={(enabled) => set({ captions: { ...value.captions, enabled } })}
            label="captions"
          />
        }
      >
        <p className="text-sm text-muted">
          {value.captions.enabled ? "we’ll caption everything that’s said." : "captions are off."}
        </p>
        <CaptionStylePicker
          value={value.captions.style}
          disabled={!value.captions.enabled}
          onChange={(style) => set({ captions: { ...value.captions, style } })}
        />
      </Section>
    </div>
  );
}

/** Problems that block making the video (shown next to the button). */
export function optionsProblem(o: VideoOptions) {
  if (o.music.mode === "track" && !o.music.trackId) return "pick a track, or choose another music option.";
  return null;
}
