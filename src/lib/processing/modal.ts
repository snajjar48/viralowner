import "server-only";
import { WorkerError, workerFetch } from "../worker";
import type { AnalysisStatus, Breakdown, ProcessingEngine, Shot, ShotRole } from "./types";

// The real engine: the processing worker on Modal (worker/app.py).
// Analysis is real; rendering joins in phase C.

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
    meta: b.meta,
  };
}

const LOST = "we lost track of this analysis. please try again.";

export const modalEngine: Pick<ProcessingEngine, "startAnalysis" | "getAnalysisStatus"> = {
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
};
