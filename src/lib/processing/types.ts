// The contract between viralowner's pages and the video-processing engine.
// The pages only ever use these types and the functions in ./index.ts, so the
// engine (the Modal worker, see ./modal.ts) can change without touching any page.

import type { CaptionStyleId, VideoOptions } from "../video-options";

export type ShotRole = "hook" | "setup" | "build" | "reveal" | "payoff" | "b-roll" | "cta";

export interface Shot {
  /** 0-based position in the edit. Shown to users as "shot index + 1". */
  index: number;
  role: ShotRole;
  /** Plain-language filming tip, e.g. "a close-up of you reacting". */
  tip: string;
  startS: number;
  durationS: number;
  /** What's on screen (real analysis only). */
  description?: string;
  /** Overlaid text in this shot, as written; null if none. */
  onScreenText?: string | null;
  /** Why this shot keeps people watching. */
  whyItWorks?: string;
}

export interface TranscriptSegment {
  startS: number;
  endS: number;
  text: string;
  /** Word timings, for captions. */
  words?: { w: string; s: number; e: number }[];
}

/** How a text overlay looks (worker/app.py: DEFAULT_TEXT_STYLE). */
export interface TextStyle {
  font: string;
  color: string;
  outline: "none" | "thin" | "thick";
  outlineColor: string;
  box: boolean;
  boxColor: string;
  shadow: boolean;
  align: "left" | "center" | "right";
  size: "small" | "medium" | "large" | "xl";
  animation: string;
  /** Capital-letter height as a fraction of the frame height (overrides `size`). */
  letterHeight?: number;
}

/** How the inspo is edited, so renders can copy it. */
export interface InspoStyle {
  /** The transition into shot i + 1 ("cut", "crossfade", "flash"...). */
  transitions: string[];
  /** Per shot: "none", "slow_zoom_in", "punch_in", "shake"... */
  motions: string[];
  colorFilter: string;
  text: TextStyle;
  /** Per shot: where its overlaid text sits ([x, y], fractions of the frame), or null. */
  textSpots: ([number, number] | null)[];
  /** Per shot: the overlaid text exactly as shown, with its line breaks. */
  textLines?: (string | null)[];
  /** "jump_cut": one continuous take with the pauses cut out (film one long clip). */
  editType?: "shots" | "jump_cut";
  /** Jump cuts that alternate between normal and zoomed-in framing. */
  alternateZoom?: boolean;
  /** Per shot: "normal", "slow_motion" or "fast". */
  speeds?: string[];
  /** Per shot: short effects ("freeze_end", "zoom_pulse", "flash_in"...). */
  shotEffects?: string[][];
  /** Looks over the whole video ("grain", "vhs", "vignette"...). */
  looks?: string[];
  /** Sound effects heard in the inspo, anchored to a cut or a shot. */
  sfx?: { anchor: "cut" | "shot"; index: number; name: string }[];
  /** The inspo's own speech captions: where they sit (vertical center) and our closest caption style. */
  captions?: { y: number | null; look: CaptionStyleId | null } | null;
  /** Analysis version (older ones are redone on their next render). */
  version?: number;
}

/** One cut of a one-take (jump-cut) video: a range of one clip. */
export interface TakeCut {
  clipId: string;
  startS: number;
  endS: number;
}

/** True when the inspo is one take with the pauses cut out. */
export const isOneTake = (b: { style?: InspoStyle } | null | undefined) => b?.style?.editType === "jump_cut";

export interface Breakdown {
  durationS: number;
  shotCount: number;
  /** Average seconds between cuts. */
  avgShotS: number;
  pacing: { label: "fast" | "medium" | "slow"; description: string };
  textOverlays: { present: boolean; style: string | null };
  captionStyle: string;
  shots: Shot[];
  /** The video as a whole (real analysis only). */
  insights?: { hook: string; structure: string; whyItWorks: string[]; audio: string };
  transcript?: { language: string | null; segments: TranscriptSegment[] };
  /** The inspo's editing style (transitions, effects, text look). Missing on older analyses. */
  style?: InspoStyle;
  /** Internal: which engine/model made this and what it cost. Never shown to users. */
  meta?: { engine: string; model: string; costUsd: number; frames: number; seconds: number };
}

export interface AnalyzeInput {
  inspirationId: string;
  storageKey: string;
  durationS: number;
}

export interface AnalysisStatus {
  state: "queued" | "processing" | "done" | "failed";
  /** What it's doing now, e.g. "finding every cut" (user-facing). */
  step: string | null;
  progress: number;
  breakdown?: Breakdown;
  /** Friendly, user-facing message when state is "failed". */
  error?: string;
}

/** A user edit of one shot, made in the preview editor. */
export interface ShotEdit {
  shotIndex: number;
  /** Which uploaded clip fills this shot. */
  clipId: string | null;
  /** Trim within that clip, in seconds. null = let the engine decide. */
  trimStartS: number | null;
  trimEndS: number | null;
}

/** Everything a render is made from. Saved on the render row as `settings`. */
export interface RenderSettings {
  options: VideoOptions;
  shots: ShotEdit[];
  /** Any number; a new seed asks for a fresh take ("regenerate"). */
  seed: number;
  /** A typed "request a change", applied to version `fromVersion`. */
  request?: string | null;
  fromVersion?: number | null;
  /** Carried from the version this one starts from: shot lengths the user asked for, caption word fixes. */
  carry?: Carry;
}

/** A word (or words) the captions got wrong, and what it should say. */
export interface CaptionFix {
  wrong: string;
  right: string;
}

export interface Carry {
  /** Inspo videos: each shot's length, when the user asked for different lengths than the inspo's. */
  shotLengths?: number[];
  captionFixes?: CaptionFix[];
  /** Phrases the user wants shown together in one caption. */
  captionGroups?: string[];
  /** The captions' words as the user retyped them (one time: the worker turns it into captionFixes). */
  captionEdit?: { before: string; after: string };
}

/** The words chosen for a version, reused by later versions that don't change the text options. */
export interface RenderText {
  /** On-screen text per shot ("" for none). */
  texts: string[];
  textPosition: "top" | "middle" | "bottom";
  textLook: "outline" | "box" | "plain";
  postCopy: PostCopy;
  /** Positions asked for per shot (vertical center, 0–1; null = automatic) and sizes (1 = standard). */
  textXs?: (number | null)[];
  textYs?: (number | null)[];
  captionYs?: (number | null)[];
  textStyle?: TextStyle;
  /** The text look picked in the options when this version was made (applied once; later changes keep). */
  textPreset?: string;
  /** The words are the user's own lines: draw them exactly as typed. */
  keepLines?: boolean;
  textScale?: number;
  captionScale?: number;
}

export interface RenderInput {
  projectId: string;
  renderId: string;
  version: number;
  /** The inspo being remade; absent for "start from scratch" videos, which have `scratch` instead. */
  inspo?: { storageKey: string; breakdown: Breakdown };
  /** "Start from scratch": the user's prompt. Claude plans the whole edit from it and the clips. */
  scratch?: { prompt: string; /** The plan a storyboard showed, made as is (opaque to the site). */ directed?: unknown };
  clips: { id: string; storageKey: string; durationS: number; position: number; shotIndex: number | null }[];
  settings: RenderSettings;
  /** Keep an earlier version's words instead of writing new ones. */
  reuseText?: RenderText;
  /** "regenerate": ask for different choices than last time. */
  fresh?: boolean;
  /** "request a change": the version to change (with what made it) and the request itself. */
  request?: string;
  previous?: { storageKey: string; plan: RenderPlan; postCopy: PostCopy | null; textChanged: boolean };
  /** One-take videos: reuse these cuts instead of cutting the take again. */
  cuts?: TakeCut[];
  /** The user's own audio file, when the music option is "upload". */
  audio?: { storageKey: string };
  /** Keep this earlier version's transitions and effects (an edit of it). */
  effects?: Record<string, unknown>;
  /** Everything the user asked for in earlier videos, oldest first (their standing preferences are learned from it). */
  history?: string[];
  /** The user's business (name, what they sell, words to spell their way), for every video. */
  business?: string;
  /** Write the post caption from the finished video even though the words are reused (made from a storyboard). */
  writePost?: boolean;
}

export type JobStage = "analyzing" | "matching" | "editing" | "finishing";
export const JOB_STAGES: JobStage[] = ["analyzing", "matching", "editing", "finishing"];

export interface PostCopy {
  caption: string;
  hashtags: string[];
  /** Other captions to choose from, each a different angle. */
  alternates?: string[];
}

export interface RenderOutput {
  /** Storage key of the finished 1080x1920 MP4. */
  storageKey: string;
  width: number;
  height: number;
  durationS: number;
  postCopy: PostCopy;
  /** What the engine actually chose: a clip and trim for every shot, and the words. */
  plan?: RenderPlan;
  /** The inspo's style, when this render had to work it out (older analyses); saved to the breakdown. */
  inspoStyle?: InspoStyle;
}

export interface RenderPlan extends Omit<RenderText, "postCopy"> {
  shots: ShotEdit[];
  /** For a "request a change" version: what was changed, for the user. */
  note?: string | null;
  /** One-take videos: where the take was cut. */
  jumpcut?: TakeCut[];
  /** The edit's transitions, motion, speed, effects, looks and sound effects (worker-defined shape). */
  effects?: Record<string, unknown>;
  /** Shot lengths the user asked for (inspo videos), the caption fixes in effect and the captions shown. */
  shotLengths?: number[];
  captionFixes?: CaptionFix[];
  captionGroups?: string[];
  captionText?: string;
  /** The caption style this version used, when a request changed it from the one in the options. */
  captionStyle?: CaptionStyleId | "off";
  /** "Start from scratch": what each shot Claude planned is for, to label them in the editor. */
  scratch?: { roles: ShotRole[]; descriptions: string[] };
}

export interface JobStatus {
  state: "queued" | "processing" | "done" | "failed";
  stage: JobStage | null;
  /** 0 to 100, across all stages. */
  progress: number;
  output?: RenderOutput;
  /** Friendly, user-facing message when state is "failed". */
  error?: string;
}

export interface ProcessingEngine {
  /** Starts analyzing an uploaded inspo; follow it with getAnalysisStatus. */
  startAnalysis(input: AnalyzeInput): Promise<{ jobId: string }>;
  getAnalysisStatus(jobId: string): Promise<AnalysisStatus>;
  startRender(input: RenderInput): Promise<{ jobId: string }>;
  getJobStatus(jobId: string): Promise<JobStatus>;
}
