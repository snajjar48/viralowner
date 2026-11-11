// The contract between viralowner's pages and the video-processing engine.
// The pages only ever use these types and the functions in ./index.ts, so the
// mock engine can be swapped for the real worker without touching any page.

import type { VideoOptions } from "../video-options";

export type ShotRole = "hook" | "setup" | "build" | "reveal" | "payoff" | "b-roll" | "cta";

export interface Shot {
  /** 0-based position in the edit. Shown to users as "shot index + 1". */
  index: number;
  role: ShotRole;
  /** Plain-language filming tip, e.g. "a close-up of you reacting". */
  tip: string;
  startS: number;
  durationS: number;
}

export interface Breakdown {
  durationS: number;
  shotCount: number;
  /** Average seconds between cuts. */
  avgShotS: number;
  pacing: { label: "fast" | "medium" | "slow"; description: string };
  textOverlays: { present: boolean; style: string | null };
  captionStyle: string;
  shots: Shot[];
}

export interface AnalyzeInput {
  inspirationId: string;
  storageKey: string;
  durationS: number;
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
}

export interface RenderInput {
  projectId: string;
  renderId: string;
  version: number;
  inspo: { storageKey: string; breakdown: Breakdown };
  clips: { id: string; storageKey: string; durationS: number; position: number; shotIndex: number | null }[];
  settings: RenderSettings;
}

export type JobStage = "analyzing" | "matching" | "editing" | "finishing";
export const JOB_STAGES: JobStage[] = ["analyzing", "matching", "editing", "finishing"];

export interface PostCopy {
  caption: string;
  hashtags: string[];
}

export interface RenderOutput {
  /** Storage key of the finished 1080x1920 MP4. */
  storageKey: string;
  width: number;
  height: number;
  durationS: number;
  postCopy: PostCopy;
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
  analyzeInspo(input: AnalyzeInput): Promise<Breakdown>;
  startRender(input: RenderInput): Promise<{ jobId: string }>;
  getJobStatus(jobId: string): Promise<JobStatus>;
}
