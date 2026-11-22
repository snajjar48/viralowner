"use client";

import { useId, useState, type ReactNode } from "react";
import {
  INSPO_AUDIO_CONFIRM_ERROR,
  LENGTH_MAX,
  LENGTH_MIN,
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
  /** Before the video is made: "write my own" piece by piece, timed on these shots. `original`: the
   * original's own text as pieces (their words greyed out in the empty boxes); `written`: the text a
   * free preview planned (shown to edit when we write it). Without it: one box for the words. */
  textPieces?: {
    shots: TimelineShot[];
    original?: OptionTextItem[];
    written?: OptionTextItem[];
    /** The original's blocks moved clear of the app's buttons, and exactly where it has them (for "keep the text exactly where"). */
    originalMoved?: OptionTextItem[];
    originalExact?: OptionTextItem[];
    /** Starts the free preview (its text then shows here to change); `previewing` while it's planned. */
    onPreview?: () => void;
    previewing?: boolean;
  };
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
  // "Start from scratch": the timeline the times are on (the previewed plan's, else the length picked).
  const timelineS = variant === "scratch" ? (textPieces?.shots.at(-1)?.end ?? value.length ?? undefined) : undefined;
  const setPieces = (items: OptionTextItem[], planBasis = value.text.planBasis) =>
    set({
      text: {
        ...value.text,
        mode: "custom",
        items,
        custom: items
          .map((it) => it.text.trim() && it.text)
          .filter(Boolean)
          .join("\n"),
        timelineS,
        planBasis,
      },
    });
  // The text a preview planned, when we write it: shown to change before the video is made (the first
  // change makes it "write my own", every piece keeping its time, so the preview still holds).
  const written = value.text.mode === "match" || value.text.mode === "adapt" ? (textPieces?.written ?? []) : [];
  const basisNow = { mode: value.text.mode, custom: value.text.custom };
  // Our text, changed by the user: their choice (match / adapt / we write it) stays picked, "with your edits".
  const basis = value.text.planBasis;
  const edited = value.text.mode === "custom" && !!basis?.fromEdit && basis.mode !== "custom" ? basis : null;
  const shownMode = edited ? edited.mode : value.text.mode;
  const undoEdits = () =>
    edited && set({ text: { ...value.text, mode: edited.mode, custom: edited.custom, items: undefined, planBasis: undefined } });
  /** "Write my own" picked: a box for each piece of the original's (or the preview's) text, its words greyed out. */
  function pickCustom() {
    const fromOriginal = textPieces?.original?.length ? textPieces.original : null;
    const from = fromOriginal ?? textPieces?.written ?? [];
    if (!textPieces || value.text.items?.length || value.text.custom.trim() || !from.length) {
      return set({ text: { ...value.text, mode: "custom", planBasis: undefined } });
    }
    setPieces(
      from.map((it) => ({ ...it, text: "", hint: it.hint ?? it.text })),
      fromOriginal ? undefined : basisNow,
    );
  }

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

      {variant === "scratch" && textPieces && (
        <Section title="length" aside={<span className="text-xs text-muted">optional</span>}>
          <VideoLength
            value={value.length ?? null}
            onChange={(length) => {
              // Text already timed keeps its place in the video (stretched or squeezed with it).
              const before = value.length ?? null;
              const items =
                before && length && value.text.items?.length
                  ? value.text.items.map((it) =>
                      it.start !== null && it.start !== undefined && it.end !== null && it.end !== undefined
                        ? { ...it, start: Math.round(((it.start * length) / before) * 100) / 100, end: Math.round(((it.end * length) / before) * 100) / 100 }
                        : it,
                    )
                  : value.text.items;
              set({ length, text: { ...value.text, items, ...(length ? { timelineS: length } : {}) } });
            }}
          />
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
              checked={shownMode === c.mode}
              onChange={() => (c.mode === "custom" ? pickCustom() : set({ text: { ...value.text, mode: c.mode, planBasis: undefined } }))}
              title={edited && c.mode === edited.mode ? `${c.title} · with your edits` : c.title}
              description={c.description}
            />
          ))}
        </div>
        {textPieces && (!!written.length || !!edited) && (
          <div className="flex flex-col gap-0.5 rounded-xl border border-coral/30 bg-coral/[0.05] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {written.length ? "the text we wrote for your preview" : "the text we wrote for your preview, with your changes"}
              </p>
              {edited && (
                <button
                  type="button"
                  onClick={undoEdits}
                  className="h-8 shrink-0 cursor-pointer rounded-full px-3 text-xs text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
                >
                  undo my changes
                </button>
              )}
            </div>
            <p className="text-xs text-muted">
              want to change a word, when it shows, where it sits or how it looks? change it here and it goes in exactly as you
              set it. your preview still holds.
            </p>
          </div>
        )}
        {textPieces && !written.length && !edited && (value.text.mode === "match" || value.text.mode === "adapt") && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2">
            <p className="text-xs text-muted">
              {textPieces.previewing
                ? "planning your preview. your text shows up here to change when it’s ready."
                : "want to see the text before it’s made, and change any of it? the preview shows it here."}
            </p>
            {textPieces.onPreview && !textPieces.previewing && (
              <button
                type="button"
                onClick={textPieces.onPreview}
                className="h-8 shrink-0 cursor-pointer rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
              >
                show me the text <span className="font-normal text-muted">· free</span>
              </button>
            )}
          </div>
        )}
        {textPieces && (value.text.mode === "custom" || !!written.length) && (
          <OptionTextPieces
            items={
              value.text.mode === "custom"
                ? value.text.items?.length
                  ? value.text.items
                  : piecesFromText(value.text.custom)
                : written
            }
            onChange={(items) => setPieces(items, value.text.mode === "custom" ? value.text.planBasis : { ...basisNow, fromEdit: true })}
            shots={textPieces.shots}
            length={variant === "scratch" ? (value.length ?? null) : null}
            planHint={variant === "scratch" && !textPieces.shots.length}
            fromScratch={variant === "scratch"}
            hintsFromPlan={!!written.length || !!value.text.planBasis}
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
          <p className="text-xs text-muted">
            this is the look for all your text.
            {textPieces && value.text.mode === "custom"
              ? " a text you’ve styled yourself under its “style & place” keeps its own look."
              : ""}
          </p>
          {variant === "inspo" && !!textPieces?.original?.length && (
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-sm">keep the text exactly where the original has it</span>
                <span className="text-xs text-muted">
                  off: text near the bottom moves up just enough to stay clear of TikTok’s and Instagram’s buttons.
                </span>
              </span>
              <Toggle
                checked={!!value.text.keepPlace}
                onChange={(keepPlace) => {
                  // Boxes still where the original's block was put go to its other place (moved by the user: kept).
                  const from = (keepPlace ? textPieces.originalMoved : textPieces.originalExact) ?? [];
                  const to = (keepPlace ? textPieces.originalExact : textPieces.originalMoved) ?? [];
                  const items = value.text.items?.map((it) => {
                    const j = from.findIndex((o) => o.text === it.hint && o.y === it.y);
                    return j >= 0 && to[j] ? { ...it, y: to[j].y, size: to[j].size } : it;
                  });
                  set({ text: { ...value.text, keepPlace: keepPlace || undefined, ...(items ? { items } : {}) } });
                }}
                label="keep the text exactly where the original has it"
              />
            </div>
          )}
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

const LENGTH_CHOICES = [10, 15, 30, 60];

/** "Start from scratch": how long the video should be (we pick, a common length, or any number of seconds). */
function VideoLength({ value, onChange }: { value: number | null; onChange: (length: number | null) => void }) {
  const [typed, setTyped] = useState(value !== null && !LENGTH_CHOICES.includes(value) ? String(value) : "");
  const chip = (on: boolean) =>
    `h-10 cursor-pointer rounded-full px-4 text-sm transition focus-visible:outline-2 focus-visible:outline-coral ${
      on ? "bg-linear-to-r from-violet to-coral font-medium text-white" : "border border-white/15 text-muted hover:text-foreground"
    }`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={value === null} onClick={() => (setTyped(""), onChange(null))} className={chip(value === null)}>
          we pick
        </button>
        {LENGTH_CHOICES.map((s) => (
          <button key={s} type="button" aria-pressed={value === s} onClick={() => (setTyped(""), onChange(s))} className={chip(value === s)}>
            {s}s
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-sm text-muted">
          or
          <input
            type="number"
            inputMode="numeric"
            min={LENGTH_MIN}
            max={LENGTH_MAX}
            value={typed}
            placeholder="—"
            aria-label="video length in seconds"
            onChange={(e) => {
              setTyped(e.target.value);
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isInteger(n) && n >= LENGTH_MIN && n <= LENGTH_MAX) onChange(n);
            }}
            className="h-10 w-16 rounded-lg border border-white/15 bg-[#15151b] px-2 text-center text-foreground outline-none focus-visible:border-coral"
          />
          seconds
        </label>
      </div>
      <p className="text-xs text-muted">
        {value === null
          ? "we make it as long as your clips and prompt need (usually 7–40 seconds)."
          : `we aim for ${value} seconds. if your clips run out first, it’ll be shorter and we’ll tell you.`}
      </p>
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
