/**
 * The kind of video, picked when a video is started (the inspo or the clips). It tells the editor
 * the vibe while the inspo is analyzed and the video is made: each category has its own playbook
 * (worker/assets/playbook/) and its own lessons learned from everyone's videos in it (lib/lessons.ts).
 * Keep the ids in step with CATEGORIES in worker/app.py.
 */
export const VIDEO_CATEGORIES = [
  { id: "food_drink", label: "food & drink", blurb: "restaurants, cafés, bars, recipes, anything people eat or sip" },
  { id: "skits", label: "skits", blurb: "characters, dialogue, a setup and a payoff" },
  { id: "talking_head", label: "talking head / yapping", blurb: "you talking to the camera: tips, stories, opinions" },
  { id: "influencer_vlog", label: "influencer / vlog", blurb: "day in the life, routines, get ready with me" },
  { id: "event_recap", label: "event recap", blurb: "parties, launches, openings, pop-ups, weddings" },
  { id: "travel", label: "travel / destination / vacation", blurb: "trips, places to go, where to stay" },
] as const;

export type VideoCategory = (typeof VIDEO_CATEGORIES)[number]["id"];

export const isCategory = (v: unknown): v is VideoCategory => VIDEO_CATEGORIES.some((c) => c.id === v);

export const categoryLabel = (id: string | null | undefined) => VIDEO_CATEGORIES.find((c) => c.id === id)?.label ?? null;

export const CATEGORY_REQUIRED = "pick what kind of video this is first.";
