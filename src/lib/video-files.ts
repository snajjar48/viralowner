// Video file rules, shared by the browser (instant feedback) and the server
// (the real check). Client-safe.

import { formatDuration } from "./video-options";

export const INSPO_MAX_SECONDS = 60;
export const INSPO_MAX_BYTES = 200 * 1024 * 1024;
export const CLIP_MAX_BYTES = 500 * 1024 * 1024;
export const CLIP_MAX_SECONDS = 5 * 60;
export const MAX_CLIPS = 20;

/** For <input accept>. Extensions too, because some browsers leave file.type empty. */
export const VIDEO_ACCEPT = "video/mp4,video/quicktime,.mp4,.mov,.m4v";

export type VideoContentType = "video/mp4" | "video/quicktime";

/** MP4 or MOV → its content type; anything else → null. */
export function videoContentType(fileName: string, type: string): VideoContentType | null {
  const t = type.toLowerCase();
  if (t === "video/mp4" || t === "video/quicktime") return t;
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  return null;
}

export const extensionFor = (type: VideoContentType) => (type === "video/quicktime" ? "mov" : "mp4");

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const MESSAGES = {
  type: "that file isn’t a video we can use. upload an MP4 or MOV.",
  empty: "that file is empty. try saving the video again.",
  unreadable: "we couldn’t read that video. try saving it again, or screen-record it and upload that.",
  inspoTooLong: (s: number) =>
    `that video is ${formatDuration(s)}. inspo videos need to be ${INSPO_MAX_SECONDS} seconds or less.`,
  inspoTooBig: (b: number) =>
    `that video is ${formatBytes(b)}. inspo videos need to be ${formatBytes(INSPO_MAX_BYTES)} or less. a screen recording is usually smaller.`,
  clipTooLong: (s: number) =>
    `that clip is ${formatDuration(s)}. clips need to be ${CLIP_MAX_SECONDS / 60} minutes or less.`,
  clipTooBig: (b: number) => `that clip is ${formatBytes(b)}. clips need to be ${formatBytes(CLIP_MAX_BYTES)} or less.`,
};

/** Checks type, size and (if known) length. Returns an error message or null. */
export function checkInspo(file: { name: string; type: string; size: number }, durationS: number | null) {
  if (!videoContentType(file.name, file.type)) return MESSAGES.type;
  if (file.size <= 0) return MESSAGES.empty;
  if (file.size > INSPO_MAX_BYTES) return MESSAGES.inspoTooBig(file.size);
  // Half a second of slack: phones often save "60s" videos as 60.3s.
  if (durationS !== null && durationS > INSPO_MAX_SECONDS + 0.5) return MESSAGES.inspoTooLong(durationS);
  return null;
}

export function checkClip(file: { name: string; type: string; size: number }, durationS: number | null) {
  if (!videoContentType(file.name, file.type)) return MESSAGES.type;
  if (file.size <= 0) return MESSAGES.empty;
  if (file.size > CLIP_MAX_BYTES) return MESSAGES.clipTooBig(file.size);
  if (durationS !== null && durationS > CLIP_MAX_SECONDS + 0.5) return MESSAGES.clipTooLong(durationS);
  return null;
}
