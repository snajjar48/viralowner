// The user's own audio file (voiceover or music). Client-safe: used by the
// uploader and re-checked on the server.

import { formatBytes } from "./video-files";

export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_ACCEPT = "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,.mp3,.m4a,.aac,.wav";

const BY_EXTENSION: Record<string, AudioContentType> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
};
const TYPES: Record<string, AudioContentType> = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/aac": "audio/aac",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
};

export type AudioContentType = "audio/mpeg" | "audio/mp4" | "audio/aac" | "audio/wav";

/** The file's type from what the browser reports, falling back to its extension. */
export function audioContentType(fileName: string, type: string): AudioContentType | null {
  return TYPES[type.toLowerCase()] ?? BY_EXTENSION[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export const audioExtension = (type: AudioContentType) =>
  ({ "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/wav": "wav" })[type];

export const AUDIO_MESSAGES = {
  type: "that file type isn’t supported. use an MP3, M4A, AAC or WAV file.",
  tooBig: (b: number) => `that file is ${formatBytes(b)}. audio files need to be ${formatBytes(AUDIO_MAX_BYTES)} or less.`,
  confirm: "please confirm the note about using this audio first.",
};

export function checkAudio(file: { name: string; type: string; size: number }) {
  if (!audioContentType(file.name, file.type)) return AUDIO_MESSAGES.type;
  if (file.size <= 0 || file.size > AUDIO_MAX_BYTES) return AUDIO_MESSAGES.tooBig(file.size);
  return null;
}

/** Reads an audio file's length in the browser (null if it can't). */
export function readAudioDuration(file: File, timeoutMs = 10_000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}
