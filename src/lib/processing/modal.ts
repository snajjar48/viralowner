import "server-only";
import { WorkerError, workerFetch } from "../worker";
import { siteUrl } from "../site-url";
import {
  JOB_STAGES,
  type AnalysisStatus,
  type Breakdown,
  type InspoStyle,
  type TextStyle,
  type JobStage,
  type JobStatus,
  type ProcessingEngine,
  type RenderOutput,
  type RenderPlan,
  type Shot,
  type ShotRole,
} from "./types";

// The real engine: the processing worker on Modal (worker/app.py).

interface WorkerJob {
  state: "queued" | "processing" | "done" | "failed";
  stage: string | null;
  progress: number;
  output?: unknown;
  error?: string;
}

const ROLES: ShotRole[] = ["hook", "setup", "build", "reveal", "payoff", "b-roll", "cta"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Checks the worker's breakdown has the shape the pages rely on. */
export function parseBreakdown(raw: unknown): Breakdown | null {
  const b = raw as Partial<Breakdown> | null;
  if (!b || !isNum(b.durationS) || !Array.isArray(b.shots) || !b.shots.length) return null;
  const shots: Shot[] = [];
  for (const [i, s] of (b.shots as Partial<Shot>[]).entries()) {
    if (!isNum(s.startS) || !isNum(s.durationS) || s.durationS <= 0) return null;
    shots.push({
      index: i,
      role: ROLES.includes(s.role as ShotRole) ? (s.role as ShotRole) : "build",
      tip: str(s.tip) || "film something similar to this shot",
      startS: s.startS,
      durationS: s.durationS,
      description: str(s.description),
      onScreenText: str(s.onScreenText) || null,
      whyItWorks: str(s.whyItWorks),
    });
  }
  const pacing = b.pacing && ["fast", "medium", "slow"].includes(b.pacing.label) ? b.pacing : null;
  if (!pacing) return null;
  return {
    durationS: b.durationS,
    shotCount: shots.length,
    avgShotS: isNum(b.avgShotS) ? b.avgShotS : Math.round((b.durationS / shots.length) * 10) / 10,
    pacing: { label: pacing.label, description: str(pacing.description) },
    textOverlays: { present: !!b.textOverlays?.present, style: str(b.textOverlays?.style) || null },
    captionStyle: str(b.captionStyle) || "none",
    shots,
    insights: b.insights
      ? {
          hook: str(b.insights.hook),
          structure: str(b.insights.structure),
          whyItWorks: Array.isArray(b.insights.whyItWorks) ? b.insights.whyItWorks.map(str).filter(Boolean) : [],
          audio: str(b.insights.audio),
        }
      : undefined,
    transcript: b.transcript,
    style: isStyle(b.style) ? b.style : undefined,
    meta: b.meta,
  };
}

/** The worker checks every value; here we only make sure the shape is there. */
function isStyle(v: unknown): v is InspoStyle {
  const st = v as Partial<InspoStyle> | null;
  return !!st && Array.isArray(st.transitions) && Array.isArray(st.motions) && !!st.text && Array.isArray(st.textSpots);
}

const POSITIONS = ["top", "middle", "bottom"] as const;
const LOOKS = ["outline", "box", "plain"] as const;

/** Checks a finished render's output. The plan is optional (the video is what matters). */
export function parseRenderOutput(raw: unknown): RenderOutput | null {
  const o = raw as Partial<RenderOutput> | null;
  if (!o || typeof o.storageKey !== "string" || !o.storageKey.startsWith("u/") || !isNum(o.durationS)) return null;
  const copy = o.postCopy;
  return {
    storageKey: o.storageKey,
    width: isNum(o.width) ? o.width : 1080,
    height: isNum(o.height) ? o.height : 1920,
    durationS: o.durationS,
    postCopy: {
      caption: str(copy?.caption),
      hashtags: Array.isArray(copy?.hashtags) ? copy.hashtags.map(str).filter(Boolean).slice(0, 10) : [],
    },
    plan: parsePlan(o.plan),
    inspoStyle: isStyle((o as { inspoStyle?: unknown }).inspoStyle) ? (o as { inspoStyle: InspoStyle }).inspoStyle : undefined,
  };
}

function parsePlan(raw: unknown): RenderPlan | undefined {
  const p = raw as Partial<RenderPlan> | null;
  if (!p || !Array.isArray(p.shots) || !Array.isArray(p.texts)) return undefined;
  const shots = p.shots.map((s, i) => ({
    shotIndex: i,
    clipId: typeof s?.clipId === "string" ? s.clipId : null,
    trimStartS: isNum(s?.trimStartS) ? Math.round(s.trimStartS * 10) / 10 : null,
    trimEndS: isNum(s?.trimEndS) ? Math.round(s.trimEndS * 10) / 10 : null,
  }));
  const ys = (v: unknown) =>
    Array.isArray(v) ? v.map((y) => (isNum(y) ? Math.min(0.95, Math.max(0.05, y)) : null)) : undefined;
  const scale = (v: unknown) => (isNum(v) ? Math.min(1.6, Math.max(0.5, v)) : undefined);
  return {
    shots,
    texts: p.texts.map(str),
    textPosition: POSITIONS.includes(p.textPosition as never) ? p.textPosition! : "top",
    textLook: LOOKS.includes(p.textLook as never) ? p.textLook! : "outline",
    textXs: ys(p.textXs),
    textYs: ys(p.textYs),
    textStyle: p.textStyle && typeof p.textStyle === "object" ? (p.textStyle as TextStyle) : undefined,
    keepLines: !!p.keepLines,
    captionYs: ys(p.captionYs),
    textScale: scale(p.textScale),
    captionScale: scale(p.captionScale),
    note: str(p.note) || null,
    effects: p.effects && typeof p.effects === "object" && !Array.isArray(p.effects) ? p.effects : undefined,
    scratch:
      p.scratch && Array.isArray(p.scratch.roles)
        ? {
            roles: p.scratch.roles.map((r) => (ROLES.includes(r) ? r : "build")),
            descriptions: Array.isArray(p.scratch.descriptions) ? p.scratch.descriptions.map(str) : [],
          }
        : undefined,
    shotLengths:
      Array.isArray(p.shotLengths) && p.shotLengths.every((x) => isNum(x) && x > 0) ? p.shotLengths : undefined,
    captionFixes: Array.isArray(p.captionFixes)
      ? p.captionFixes
          .filter((f) => f && typeof f.wrong === "string" && typeof f.right === "string" && f.wrong.trim())
          .slice(0, 40)
          .map((f) => ({ wrong: f.wrong, right: f.right }))
      : undefined,
    captionText: typeof p.captionText === "string" ? p.captionText.slice(0, 5000) : undefined,
    jumpcut: Array.isArray(p.jumpcut)
      ? p.jumpcut.filter((c) => c && typeof c.clipId === "string" && isNum(c.startS) && isNum(c.endS))
      : undefined,
  };
}

/** Where a render's MP4 goes: in the same user's project folder as its inspo or clips. */
function outputKeyFor(fileKey: string, version: number, renderId: string) {
  const folder = /^u\/[^/]+\/p\/[^/]+\//.exec(fileKey)?.[0];
  if (!folder) throw new Error("Unexpected storage key for a render");
  return `${folder}renders/v${version}-${renderId}.mp4`;
}

const LOST = "we lost track of this analysis. please try again.";
const LOST_RENDER = "we lost track of this video. please try again.";

export const modalEngine: ProcessingEngine = {
  async startAnalysis({ storageKey }) {
    return workerFetch<{ jobId: string }>("/jobs/analyze", { method: "POST", body: { storageKey }, timeoutMs: 30_000 });
  },

  async getAnalysisStatus(jobId): Promise<AnalysisStatus> {
    let job: WorkerJob;
    try {
      job = await workerFetch<WorkerJob>(`/jobs/${encodeURIComponent(jobId)}`);
    } catch (error) {
      if (error instanceof WorkerError && error.status === 404) {
        return { state: "failed", step: null, progress: 0, error: LOST };
      }
      throw error;
    }
    if (job.state === "done") {
      const breakdown = parseBreakdown(job.output);
      if (!breakdown) {
        console.error("Worker returned an unusable breakdown for job", jobId);
        return { state: "failed", step: null, progress: 0, error: "we couldn’t analyze that video. please try again." };
      }
      return { state: "done", step: null, progress: 100, breakdown };
    }
    return { state: job.state, step: job.stage, progress: job.progress, error: job.error };
  },

  async startRender(input) {
    return workerFetch<{ jobId: string }>("/jobs/render", {
      method: "POST",
      timeoutMs: 30_000,
      body: {
        outputKey: outputKeyFor(input.inspo?.storageKey ?? input.clips[0].storageKey, input.version, input.renderId),
        ...(input.inspo ? { inspo: input.inspo } : {}),
        ...(input.scratch ? { scratch: input.scratch } : {}),
        clips: input.clips.map((c) => ({ id: c.id, storageKey: c.storageKey })),
        shots: input.settings.shots,
        options: input.settings.options,
        reuse: input.reuseText ?? null,
        fresh: !!input.fresh,
        request: input.request ?? null,
        previous: input.previous ?? null,
        cuts: input.cuts ?? null,
        audio: input.audio ?? null,
        effects: input.effects ?? null,
        carry: input.settings.carry ?? null,
        // The worker calls this when the video is done, so we can email the user.
        notify: { url: `${siteUrl()}/api/worker/render-done`, projectId: input.projectId, renderId: input.renderId },
      },
    });
  },

  async getJobStatus(jobId): Promise<JobStatus> {
    let job: WorkerJob;
    try {
      job = await workerFetch<WorkerJob>(`/jobs/${encodeURIComponent(jobId)}`);
    } catch (error) {
      if (error instanceof WorkerError && error.status === 404) {
        return { state: "failed", stage: null, progress: 0, error: LOST_RENDER };
      }
      throw error;
    }
    const stage = JOB_STAGES.includes(job.stage as JobStage) ? (job.stage as JobStage) : null;
    if (job.state === "done") {
      const output = parseRenderOutput(job.output);
      if (!output) {
        console.error("Worker returned an unusable render for job", jobId);
        return { state: "failed", stage: null, progress: 0, error: "something went wrong while making your video. please try again." };
      }
      return { state: "done", stage: "finishing", progress: 100, output };
    }
    if (job.state === "failed") return { state: "failed", stage, progress: job.progress, error: job.error };
    return { state: job.state, stage, progress: job.progress };
  },
};
