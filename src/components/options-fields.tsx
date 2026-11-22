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
  type OptionTextItem,
  type VideoOptions,
} from "@/lib/video-options";
import { OptionTextPieces, piecesFromText } from "./option-text-pieces";
import type { TimelineShot } from "./text-pieces";
import { AudioRightsNotice } from "./audio-rights";
import { CaptionStylePicker, TextStylePicker, Toggle } from "./caption-styles";
import { QuickAdd } from "./quick-add";
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
  { mode: "match", title: "match the original", description: "the same words, style and placement as the original video" },
  { mode: "adapt", title: "match the style, use my business", description: "same style and placement, words about you" },
  { mode: "custom", title: "write my own", description: "your exact words and lines, in the original’s style" },
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
      title: "use the original video’s sound",
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
  textPieces,
}: {
  /** Before the video is made: "write my own" piece by piece, timed on these shots, and the
   * original's own text as pieces (to start from). Without it: one box for the words. */
  textPieces?: { shots: TimelineShot[]; original?: OptionTextItem[] };
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
  const setPieces = (items: OptionTextItem[]) =>
    set({ text: { ...value.text, mode: "custom", items, custom: items.map((it) => it.text).join("\n") } });

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
          <div className="flex items-start justify-between gap-3">
            <QuickAdd value={value.notes} onChange={(notes) => set({ notes })} max={NOTES_MAX} />
            <span className="shrink-0 text-xs text-muted tabular-nums">
              {value.notes.length}/{NOTES_MAX}
            </span>
          </div>
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
        {textPieces && value.text.mode !== "custom" && variant === "inspo" && !!textPieces.original?.length && (
          <button
            type="button"
            onClick={() => setPieces(textPieces.original!.map((it) => ({ ...it })))}
            className="self-start text-left text-xs text-muted underline underline-offset-4 hover:text-foreground"
          >
            want to change a line, when it shows or how it looks? start from the original’s text, piece by piece.
          </button>
        )}
        {value.text.mode === "custom" && textPieces && (
          <OptionTextPieces
            items={value.text.items?.length ? value.text.items : piecesFromText(value.text.custom)}
            onChange={setPieces}
            shots={textPieces.shots}
          />
        )}
        {value.text.mode === "custom" && !textPieces && (
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
              // Typed as one box: the pieces set up before (their own times and looks) no longer apply.
              onChange={(e) => set({ text: { ...value.text, mode: "custom", custom: e.target.value, items: undefined } })}
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
        <div className={`flex flex-col gap-1.5 ${value.text.mode === "none" ? "hidden" : ""}`}>
          <span className="text-sm text-muted">style</span>
          <TextStylePicker
            value={value.text.style}
            onChange={(style) => set({ text: { ...value.text, style } })}
            autoName={variant === "scratch" ? "we pick" : "like the original"}
          />
        </div>
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
        {value.captions.enabled && (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={value.captions.emojis}
              onChange={(e) => set({ captions: { ...value.captions, emojis: e.target.checked } })}
              className="mt-0.5 size-4 shrink-0 accent-coral"
            />
            <span>
              emoji pop-ups <span className="text-muted">· an emoji beside a punchy word every few seconds</span>
            </span>
          </label>
        )}
      </Section>

      <Section title="series">
        <label className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">part of a series? this is part</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            value={value.series.part ?? ""}
            placeholder="—"
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              set({ series: { part: Number.isInteger(n) && n >= 1 && n <= 999 ? n : null } });
            }}
            aria-label="series part number"
            className="h-10 w-20 rounded-lg border border-white/15 bg-[#15151b] px-3 text-center text-foreground outline-none focus-visible:border-coral"
          />
        </label>
        <p className="text-xs text-muted">
          adds a small “part {value.series.part ?? "2"}” label to the top of the video and mentions it in the post
          caption. leave it empty if it’s a one-off.
        </p>
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
