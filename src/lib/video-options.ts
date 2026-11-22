// Step 3 options. Client-safe: used by the options page and validated on the
// server with parseVideoOptions before anything is saved or rendered.

/** match: the inspo's own words, style and placement. adapt: its style and placement, words about
 * the user's business (from scratch: Claude writes them). custom: the user's own lines, exactly as
 * typed. none: no on-screen text (start from scratch only). */
export type TextMode = "match" | "adapt" | "custom" | "none";
export type TextAlign = "inspo" | "left" | "center" | "right";
/** upload: the user's own audio file (added on the clips step). */
export type MusicMode = "original" | "inspo" | "upload" | "none";
export type CaptionStyleId = "bold-pop" | "clean" | "outline" | "bold-outline" | "boxed" | "karaoke";
/** auto: the inspo's text style (remakes), or ours (start from scratch). Otherwise a fixed look. */
export type TextStyleId = "auto" | "classic" | "bold-pop" | "boxed" | "dark-box" | "headline" | "handwritten" | "neon";

/** How one piece of on-screen text looks and where it sits (null / missing = the video's own). */
export interface TextLook {
  /** Vertical center (0 top, 1 bottom). */
  y?: number | null;
  /** Horizontal anchor (see align). */
  x?: number | null;
  align?: "left" | "center" | "right" | null;
  /** 1 = standard size. */
  size?: number;
  color?: string | null;
  font?: string | null;
  look?: "outline" | "box" | "plain" | null;
  animation?: string | null;
}

/** One piece of the user's own text ("write my own"), set up before the video is made. */
export interface OptionTextItem extends TextLook {
  text: string;
  /** Shown on these shots only (the original's shot numbers, 0-based). */
  shots?: number[] | null;
  /** Or from/to, in seconds of the original video. No shots and no times: we pick when. */
  start?: number | null;
  end?: number | null;
}

export interface VideoOptions {
  /** items: "write my own" as separate pieces, each with its own timing and look (custom is their words, joined). */
  text: { mode: TextMode; custom: string; align: TextAlign; style: TextStyleId; items?: OptionTextItem[] };
  /** inspoAudioConfirmed: the user accepted the disclaimer for using the inspo's audio. */
  music: { mode: MusicMode; inspoAudioConfirmed: boolean };
  /** emojis: emoji pop-ups beside punchy captions. */
  captions: { enabled: boolean; style: CaptionStyleId; emojis: boolean };
  /** "additional requests": anything the user wants the edit to know or do. */
  notes: string;
  /** Part of a series: a "part 2" label on the video (and in the post caption). */
  series: { part: number | null };
  /** "Start from scratch": how long the user wants the video, in seconds (null/missing: we pick). */
  length?: number | null;
}

export const LENGTH_MIN = 5;
export const LENGTH_MAX = 180;

export const TEXT_MAX = 300;
export const NOTES_MAX = 1500;
/** A typed "request a change" in the preview editor. */
export const REQUEST_MAX = 1500;
/** "Start from scratch": the user's description of the video they want. */
export const PROMPT_MAX = 2000;

export const DEFAULT_OPTIONS: VideoOptions = {
  text: { mode: "match", custom: "", align: "inspo", style: "auto" },
  music: { mode: "original", inspoAudioConfirmed: false },
  captions: { enabled: true, style: "bold-pop", emojis: false },
  notes: "",
  series: { part: null },
};

export const NO_AUDIO_FILE_ERROR = "add your audio file on the clips step, or choose another music option.";

export const INSPO_AUDIO_CONFIRM_ERROR =
  "please confirm the note about the original video’s sound, or choose another music option.";

export const CAPTION_STYLES: { id: CaptionStyleId; name: string; description: string }[] = [
  { id: "bold-pop", name: "bold pop", description: "big, bold, one or two words at a time" },
  { id: "clean", name: "clean", description: "white semi-bold sentences, soft shadow" },
  { id: "outline", name: "outline", description: "white semi-bold text with a black outline, the classic look" },
  { id: "bold-outline", name: "bold outline", description: "bolder white text with a thicker outline" },
  { id: "boxed", name: "boxed", description: "text on a solid background" },
  { id: "karaoke", name: "highlight", description: "each word lights up as it's spoken" },
];

const TEXT_MODES: TextMode[] = ["match", "adapt", "custom", "none"];
const TEXT_ALIGNS: TextAlign[] = ["inspo", "left", "center", "right"];
// Old projects may have "track" saved (a music library that was never launched): it reads as "original".
const MUSIC_MODES: MusicMode[] = ["original", "inspo", "upload", "none"];
const CAPTION_IDS = CAPTION_STYLES.map((s) => s.id);

/** On-screen text looks (the worker has the same ids in TEXT_PRESETS). */
export const TEXT_STYLES: { id: Exclude<TextStyleId, "auto">; name: string; description: string }[] = [
  { id: "classic", name: "classic", description: "white with a black stroke" },
  { id: "bold-pop", name: "bold pop", description: "heavy yellow with a black stroke" },
  { id: "boxed", name: "boxed", description: "black text on a white box" },
  { id: "dark-box", name: "dark box", description: "white text on a black box" },
  { id: "headline", name: "headline", description: "tall condensed letters" },
  { id: "handwritten", name: "handwritten", description: "marker capitals" },
  { id: "neon", name: "neon", description: "pink with a white stroke" },
];
const TEXT_STYLE_IDS: TextStyleId[] = ["auto", ...TEXT_STYLES.map((s) => s.id)];

export const TEXT_FONTS = ["clean_sans", "semibold_sans", "heavy_sans", "condensed", "tall_caps", "serif", "typewriter", "marker", "script", "rounded"];
export const TEXT_ANIMATIONS = ["none", "pop", "fade", "typewriter", "word_by_word", "slide_up"];
export const TEXT_ITEMS_MAX = 20;

const clampNum = (v: unknown, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;

/** A piece of text's own look and place, from untrusted input (anything invalid: the video's own). */
export function textLookFrom(raw: Record<string, unknown>): Required<TextLook> {
  return {
    y: clampNum(raw.y, 0, 1),
    x: clampNum(raw.x, 0, 1),
    align: raw.align === "left" || raw.align === "right" || raw.align === "center" ? raw.align : null,
    size: clampNum(raw.size, 0.4, 2.5) ?? 1,
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toUpperCase() : null,
    font: typeof raw.font === "string" && TEXT_FONTS.includes(raw.font) ? raw.font : null,
    look: raw.look === "outline" || raw.look === "box" || raw.look === "plain" ? raw.look : null,
    animation: typeof raw.animation === "string" && TEXT_ANIMATIONS.includes(raw.animation) ? raw.animation : null,
  };
}

const cleanLines = (s: string) =>
  s
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

/** "Write my own" pieces from untrusted input: words kept line for line, timing and look checked. */
function optionTextItems(input: unknown): OptionTextItem[] {
  if (!Array.isArray(input)) return [];
  const out: OptionTextItem[] = [];
  for (const v of input.slice(0, TEXT_ITEMS_MAX)) {
    const raw = obj(v);
    const text = typeof raw.text === "string" ? cleanLines(raw.text).slice(0, TEXT_MAX) : "";
    if (!text) continue;
    const shots = Array.isArray(raw.shots)
      ? [...new Set(raw.shots.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 100))].sort((a, b) => a - b)
      : [];
    const start = clampNum(raw.start, 0, 600);
    const end = clampNum(raw.end, 0, 600);
    const timed = !shots.length && start !== null && end !== null && end - start >= 0.1;
    out.push({
      text,
      shots: shots.length ? shots : null,
      start: timed ? Math.round(start * 100) / 100 : null,
      end: timed ? Math.round(end * 100) / 100 : null,
      ...textLookFrom(raw),
    });
  }
  return out;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Turns untrusted input (a request body, or JSON from the database) into
 * valid options. Unknown or missing values fall back to the defaults.
 * Returns an error only for things the user should fix.
 */
export function parseVideoOptions(input: unknown): VideoOptions | { error: string } {
  const raw = obj(input);
  const text = obj(raw.text);
  const music = obj(raw.music);
  const captions = obj(raw.captions);
  const series = obj(raw.series);
  const part = typeof series.part === "number" && Number.isInteger(series.part) ? series.part : null;
  if (part !== null && (part < 1 || part > 999)) return { error: "the series part needs to be a number from 1 to 999." };

  // Keep the user's line breaks: each line they type is its own line on screen. Typed as separate
  // pieces: the words are the pieces' words, in order.
  const items = optionTextItems(text.items);
  const custom = items.length
    ? items.map((it) => it.text).join("\n")
    : typeof text.custom === "string"
      ? cleanLines(text.custom)
      : "";
  if (custom.length > TEXT_MAX) {
    return { error: `on-screen text can be up to ${TEXT_MAX} characters.` };
  }
  const notes = typeof raw.notes === "string" ? raw.notes.trim() : "";
  if (notes.length > NOTES_MAX) {
    return { error: `additional requests can be up to ${NOTES_MAX} characters.` };
  }
  const length =
    typeof raw.length === "number" && Number.isFinite(raw.length)
      ? Math.round(Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, raw.length)))
      : null;
  const textMode = TEXT_MODES.includes(text.mode as TextMode) ? (text.mode as TextMode) : DEFAULT_OPTIONS.text.mode;

  const musicMode = MUSIC_MODES.includes(music.mode as MusicMode)
    ? (music.mode as MusicMode)
    : DEFAULT_OPTIONS.music.mode;
  const inspoAudioConfirmed = music.inspoAudioConfirmed === true;
  if (musicMode === "inspo" && !inspoAudioConfirmed) return { error: INSPO_AUDIO_CONFIRM_ERROR };

  return {
    text: {
      mode: textMode === "custom" && !custom ? "match" : textMode,
      custom,
      align: TEXT_ALIGNS.includes(text.align as TextAlign) ? (text.align as TextAlign) : "inspo",
      style: TEXT_STYLE_IDS.includes(text.style as TextStyleId) ? (text.style as TextStyleId) : "auto",
      ...(items.length ? { items } : {}),
    },
    music: {
      mode: musicMode,
      inspoAudioConfirmed: musicMode === "inspo" && inspoAudioConfirmed,
    },
    captions: {
      enabled: typeof captions.enabled === "boolean" ? captions.enabled : DEFAULT_OPTIONS.captions.enabled,
      style: CAPTION_IDS.includes(captions.style as CaptionStyleId)
        ? (captions.style as CaptionStyleId)
        : DEFAULT_OPTIONS.captions.style,
      emojis: captions.emojis === true,
    },
    notes,
    series: { part },
    ...(length !== null ? { length } : {}),
  };
}

/** Options as stored in the database (never errors; invalid → defaults). */
/**
 * "Start from scratch" has no inspo to match: its text is Claude's, the user's own, or none,
 * and its sound is the clips', the user's file, or none.
 */
export function scratchOptions(o: VideoOptions): VideoOptions {
  return {
    ...o,
    text: { ...o.text, mode: o.text.mode === "match" ? "adapt" : o.text.mode },
    music: { ...o.music, mode: o.music.mode === "inspo" ? "original" : o.music.mode, inspoAudioConfirmed: false },
  };
}

/** Inspo videos never use "none" (it's offered from scratch only). */
export function inspoOptions(o: VideoOptions): VideoOptions {
  return o.text.mode === "none" ? { ...o, text: { ...o.text, mode: "match" } } : o;
}

export function optionsFromJson(json: unknown): VideoOptions {
  const parsed = parseVideoOptions(json);
  return "error" in parsed ? DEFAULT_OPTIONS : parsed;
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
