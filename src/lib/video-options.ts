// Step 3 options. Client-safe: used by the options page and validated on the
// server with parseVideoOptions before anything is saved or rendered.

/** match: the inspo's own words, style and placement. adapt: its style and placement, words about
 * the user's business. custom: the user's own lines, exactly as typed. */
export type TextMode = "match" | "adapt" | "custom";
export type TextAlign = "inspo" | "left" | "center" | "right";
export type MusicMode = "track" | "original" | "inspo" | "none";
export type CaptionStyleId = "bold-pop" | "clean" | "boxed" | "karaoke";

export interface VideoOptions {
  text: { mode: TextMode; custom: string; align: TextAlign };
  /** inspoAudioConfirmed: the user accepted the disclaimer for using the inspo's audio. */
  music: { mode: MusicMode; trackId: string | null; inspoAudioConfirmed: boolean };
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
  music: { mode: "original", trackId: null, inspoAudioConfirmed: false },
  captions: { enabled: true, style: "bold-pop" },
  notes: "",
};

export const INSPO_AUDIO_CONFIRM_ERROR =
  "please confirm the note about the inspo’s audio, or choose another music option.";

export interface Track {
  id: string;
  title: string;
  artist: string;
  mood: string;
  bpm: number;
  durationS: number;
  /** Preview audio. Placeholder library: null until real licensed tracks exist. */
  previewUrl: string | null;
}

/** Placeholder licensed-track library. Swap for the real catalog later. */
export const TRACKS: Track[] = [
  { id: "trk_sunset_drive", title: "sunset drive", artist: "nova lane", mood: "upbeat", bpm: 118, durationS: 32, previewUrl: null },
  { id: "trk_glow_up", title: "glow up", artist: "kiko", mood: "hype", bpm: 128, durationS: 28, previewUrl: null },
  { id: "trk_soft_focus", title: "soft focus", artist: "maren", mood: "chill", bpm: 92, durationS: 40, previewUrl: null },
  { id: "trk_big_reveal", title: "big reveal", artist: "the edit room", mood: "dramatic", bpm: 100, durationS: 30, previewUrl: null },
  { id: "trk_morning_run", title: "morning run", artist: "pace setter", mood: "energetic", bpm: 140, durationS: 26, previewUrl: null },
  { id: "trk_cafe_loop", title: "café loop", artist: "lofi supply", mood: "cozy", bpm: 84, durationS: 45, previewUrl: null },
  { id: "trk_main_character", title: "main character", artist: "juno ray", mood: "confident", bpm: 110, durationS: 34, previewUrl: null },
  { id: "trk_tiny_wins", title: "tiny wins", artist: "pocket band", mood: "playful", bpm: 122, durationS: 24, previewUrl: null },
];

export const CAPTION_STYLES: { id: CaptionStyleId; name: string; description: string }[] = [
  { id: "bold-pop", name: "bold pop", description: "big, bold, one or two words at a time" },
  { id: "clean", name: "clean", description: "simple white text, full sentences" },
  { id: "boxed", name: "boxed", description: "text on a solid background" },
  { id: "karaoke", name: "highlight", description: "each word lights up as it's spoken" },
];

const TEXT_MODES: TextMode[] = ["match", "adapt", "custom"];
const TEXT_ALIGNS: TextAlign[] = ["inspo", "left", "center", "right"];
const MUSIC_MODES: MusicMode[] = ["track", "original", "inspo", "none"];
const CAPTION_IDS = CAPTION_STYLES.map((s) => s.id);
const TRACK_IDS = new Set(TRACKS.map((t) => t.id));

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

  let musicMode = MUSIC_MODES.includes(music.mode as MusicMode)
    ? (music.mode as MusicMode)
    : DEFAULT_OPTIONS.music.mode;
  const trackId = typeof music.trackId === "string" && TRACK_IDS.has(music.trackId) ? music.trackId : null;
  if (musicMode === "track" && !trackId) {
    if (music.mode === "track") return { error: "pick a track, or choose another music option." };
    musicMode = DEFAULT_OPTIONS.music.mode;
  }
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
      trackId: musicMode === "track" ? trackId : null,
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
