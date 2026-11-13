// Step 3 options. Client-safe: used by the options page and validated on the
// server with parseVideoOptions before anything is saved or rendered.

/** match: the inspo's own words, style and placement. adapt: its style and placement, words about
 * the user's business. custom: the user's own lines, exactly as typed. */
export type TextMode = "match" | "adapt" | "custom";
export type TextAlign = "inspo" | "left" | "center" | "right";
/** upload: the user's own audio file (added on the clips step). */
export type MusicMode = "original" | "inspo" | "upload" | "none";
export type CaptionStyleId = "bold-pop" | "clean" | "boxed" | "karaoke";

export interface VideoOptions {
  text: { mode: TextMode; custom: string; align: TextAlign };
  /** inspoAudioConfirmed: the user accepted the disclaimer for using the inspo's audio. */
  music: { mode: MusicMode; inspoAudioConfirmed: boolean };
  captions: { enabled: boolean; style: CaptionStyleId };
  /** "additional requests": anything the user wants the edit to know or do. */
  notes: string;
}

export const TEXT_MAX = 300;
export const NOTES_MAX = 500;
/** A typed "request a change" in the preview editor. */
export const REQUEST_MAX = 500;

export const DEFAULT_OPTIONS: VideoOptions = {
  text: { mode: "match", custom: "", align: "inspo" },
  music: { mode: "original", inspoAudioConfirmed: false },
  captions: { enabled: true, style: "bold-pop" },
  notes: "",
};

export const NO_AUDIO_FILE_ERROR = "add your audio file on the clips step, or choose another music option.";

export const INSPO_AUDIO_CONFIRM_ERROR =
  "please confirm the note about the inspo’s audio, or choose another music option.";

export const CAPTION_STYLES: { id: CaptionStyleId; name: string; description: string }[] = [
  { id: "bold-pop", name: "bold pop", description: "big, bold, one or two words at a time" },
  { id: "clean", name: "clean", description: "simple white text, full sentences" },
  { id: "boxed", name: "boxed", description: "text on a solid background" },
  { id: "karaoke", name: "highlight", description: "each word lights up as it's spoken" },
];

const TEXT_MODES: TextMode[] = ["match", "adapt", "custom"];
const TEXT_ALIGNS: TextAlign[] = ["inspo", "left", "center", "right"];
// Old projects may have "track" saved (a music library that was never launched): it reads as "original".
const MUSIC_MODES: MusicMode[] = ["original", "inspo", "upload", "none"];
const CAPTION_IDS = CAPTION_STYLES.map((s) => s.id);

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

  // Keep the user's line breaks: each line they type is its own line on screen.
  const custom =
    typeof text.custom === "string"
      ? text.custom
          .replace(/\r/g, "")
          .split("\n")
          .map((line) => line.trim())
          .join("\n")
          .trim()
      : "";
  if (custom.length > TEXT_MAX) {
    return { error: `on-screen text can be up to ${TEXT_MAX} characters.` };
  }
  const notes = typeof raw.notes === "string" ? raw.notes.trim() : "";
  if (notes.length > NOTES_MAX) {
    return { error: `additional requests can be up to ${NOTES_MAX} characters.` };
  }
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
    },
    notes,
  };
}

/** Options as stored in the database (never errors; invalid → defaults). */
export function optionsFromJson(json: unknown): VideoOptions {
  const parsed = parseVideoOptions(json);
  return "error" in parsed ? DEFAULT_OPTIONS : parsed;
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
