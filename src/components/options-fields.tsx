"use client";

import { useId, type ReactNode } from "react";
import {
  INSPO_AUDIO_CONFIRM_ERROR,
  NO_AUDIO_FILE_ERROR,
  NOTES_MAX,
  TEXT_MAX,
  type MusicMode,
  type TextAlign,
  type TextMode,
  type VideoOptions,
} from "@/lib/video-options";
import { AudioRightsNotice } from "./audio-rights";
import { CaptionStylePicker, Toggle } from "./caption-styles";
import { MusicIcon, SparkleIcon, TextIcon } from "./icons";
import { inputClass } from "./form";

export function Section({
  title,
  icon,
  children,
  aside,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 ${className}`}>
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
        checked
          ? "border-coral/60 bg-coral/10"
          : "border-white/10 hover:border-white/25"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-coral" : "border-white/30"
        }`}
      >
        {checked && (
          <span className="size-2.5 rounded-full bg-linear-to-r from-violet to-coral" />
        )}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        {description && (
          <span className="text-xs text-muted">{description}</span>
        )}
      </span>
    </label>
  );
}

const TEXT_CHOICES: { mode: TextMode; title: string; description: string }[] = [
  { mode: "match", title: "match the inspo", description: "the same words, style and placement as the inspo" },
  { mode: "adapt", title: "match the style, use my business", description: "same style and placement, words about you" },
  { mode: "custom", title: "write my own", description: "your exact words and lines, in the inspo’s style" },
];

// "Start from scratch": there's no inspo to match.
const SCRATCH_TEXT_CHOICES: { mode: TextMode; title: string; description: string }[] = [
  { mode: "adapt", title: "we write it", description: "short, punchy text from your prompt and clips" },
  { mode: "custom", title: "write my own", description: "your exact words and lines" },
  { mode: "none", title: "no on-screen text", description: "just the video (captions are separate, below)" },
];

const ALIGN_CHOICES: { align: TextAlign; title: string }[] = [
  { align: "inspo", title: "like inspo" },
  { align: "left", title: "left" },
  { align: "center", title: "center" },
  { align: "right", title: "right" },
];

const MUSIC_CHOICES: { mode: MusicMode; title: string; description: string }[] =
  [
    {
      mode: "original",
      title: "keep my clips’ original audio",
      description: "your voice and sounds, as filmed",
    },
    {
      mode: "inspo",
      title: "use the inspo’s audio",
      description: "the same sound as the video you’re recreating",
    },
    {
      mode: "none",
      title: "no music",
      description: "add a trending sound in the app when you post",
    },
  ];

/** On-screen text, music and captions. Used on step 3 and in the preview editor. */
export function OptionsFields({
  value,
  onChange,
  showNotes = true,
  uploadedAudio = null,
  variant = "inspo",
}: {
  value: VideoOptions;
  onChange: (next: VideoOptions) => void;
  /** "scratch": a "start from scratch" video (no inspo to match or take audio from). */
  variant?: "inspo" | "scratch";
  /** The user's own audio file (added on the clips step), if any. */
  uploadedAudio?: { fileName: string } | null;
  /** The preview editor has "request a change" instead. */
  showNotes?: boolean;
}) {
  const id = useId();
  const set = (patch: Partial<VideoOptions>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-4">
      {showNotes && (
        <Section
          title="additional requests"
          icon={<SparkleIcon className="size-4 text-muted" />}
          aside={<span className="text-xs text-muted">optional</span>}
        >
          <label htmlFor={`${id}-notes`} className="text-sm text-muted">
            anything we should know? your business name, what to show off, words
            to use or avoid, the vibe you want.
          </label>
          <textarea
            id={`${id}-notes`}
            value={value.notes}
            maxLength={NOTES_MAX}
            rows={3}
            placeholder="e.g. we’re a dessert shop in north olmsted. show off the new strawberry croffle and keep it playful."
            onChange={(e) => set({ notes: e.target.value })}
            className={`${inputClass} h-auto py-3`}
          />
          <span className="self-end text-xs text-muted tabular-nums">
            {value.notes.length}/{NOTES_MAX}
          </span>
        </Section>
      )}

      <Section
        title="on-screen text"
        icon={<TextIcon className="size-4 text-muted" />}
      >
        <div className="flex flex-col gap-2">
          {(variant === "scratch" ? SCRATCH_TEXT_CHOICES : TEXT_CHOICES).map((c) => (
            <Choice
              key={c.mode}
              name={`${id}-text`}
              checked={value.text.mode === c.mode}
              onChange={() => set({ text: { ...value.text, mode: c.mode } })}
              title={c.title}
              description={c.description}
            />
          ))}
        </div>
        {value.text.mode === "custom" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-custom`} className="text-sm text-muted">
              your text. each line you type shows up as its own line, exactly as you wrote it.
            </label>
            <textarea
              id={`${id}-custom`}
              value={value.text.custom}
              maxLength={TEXT_MAX}
              rows={4}
              placeholder={"e.g.\npov:\nyou found the best croffles in town"}
              onChange={(e) => set({ text: { ...value.text, mode: "custom", custom: e.target.value } })}
              className={`${inputClass} h-auto py-3`}
            />
            <span className="self-end text-xs text-muted tabular-nums">
              {value.text.custom.length}/{TEXT_MAX}
            </span>
          </div>
        )}
        <fieldset className={`flex flex-col gap-1.5 ${value.text.mode === "none" ? "hidden" : ""}`}>
          <legend className="mb-1.5 text-sm text-muted">alignment</legend>
          <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/10 p-1">
            {ALIGN_CHOICES.map((c) => (
              <label
                key={c.align}
                className={`flex cursor-pointer items-center justify-center rounded-lg px-1 py-2 text-xs transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-coral sm:text-sm ${
                  value.text.align === c.align
                    ? "bg-linear-to-r from-violet to-coral font-medium text-white"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <input
                  type="radio"
                  name={`${id}-align`}
                  checked={value.text.align === c.align}
                  onChange={() => set({ text: { ...value.text, align: c.align } })}
                  className="sr-only"
                />
                {variant === "scratch" && c.align === "inspo" ? "auto" : c.title}
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section title="music" icon={<MusicIcon className="size-4 text-muted" />}>
        <div className="flex flex-col gap-2">
          {[
            ...(uploadedAudio || value.music.mode === "upload"
              ? [
                  {
                    mode: "upload" as MusicMode,
                    title: "use my audio file",
                    description: uploadedAudio ? uploadedAudio.fileName : "your file isn’t uploaded anymore",
                  },
                ]
              : []),
            ...MUSIC_CHOICES.filter((c) => variant !== "scratch" || c.mode !== "inspo"),
          ].map((c) => (
            <Choice
              key={c.mode}
              name={`${id}-music`}
              checked={value.music.mode === c.mode}
              onChange={() => set({ music: { ...value.music, mode: c.mode } })}
              title={c.title}
              description={c.description}
            />
          ))}
        </div>
        {value.music.mode === "inspo" && (
          <AudioRightsNotice
            source="inspo"
            checked={value.music.inspoAudioConfirmed}
            onChange={(inspoAudioConfirmed) => set({ music: { ...value.music, inspoAudioConfirmed } })}
          />
        )}
        {value.music.mode === "upload" && !uploadedAudio && (
          <p className="rounded-xl border border-coral/30 bg-coral/[0.06] p-3 text-sm">{NO_AUDIO_FILE_ERROR}</p>
        )}
      </Section>

      <Section
        title="captions"
        aside={
          <Toggle
            checked={value.captions.enabled}
            onChange={(enabled) =>
              set({ captions: { ...value.captions, enabled } })
            }
            label="captions"
          />
        }
      >
        <p className="text-sm text-muted">
          {value.captions.enabled
            ? "we’ll caption everything that’s said."
            : "captions are off."}
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
export function optionsProblem(o: VideoOptions, hasAudioFile = true) {
  if (o.music.mode === "inspo" && !o.music.inspoAudioConfirmed)
    return INSPO_AUDIO_CONFIRM_ERROR;
  if (o.music.mode === "upload" && !hasAudioFile) return NO_AUDIO_FILE_ERROR;
  return null;
}
