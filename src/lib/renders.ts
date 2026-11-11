import "server-only";
import { getJobStatus, startRender, type RenderSettings, type ShotEdit } from "./processing";
import {
  createRender,
  getInspiration,
  listClips,
  setRenderJob,
  updateRender,
  type Clip,
  type Project,
  type Render,
} from "./projects";
import type { VideoOptions } from "./video-options";

type Fail = { error: string; status: number };

/** Shot edits from the clips the user assigned in step 2 (no trims). */
export function shotsFromAssignments(shotCount: number, clips: Clip[]): ShotEdit[] {
  return Array.from({ length: shotCount }, (_, shotIndex) => ({
    shotIndex,
    clipId: clips.find((c) => c.status === "uploaded" && c.shotIndex === shotIndex)?.id ?? null,
    trimStartS: null,
    trimEndS: null,
  }));
}

const MIN_SHOT_S = 0.3;

/** Validates shot edits from the preview editor against the project's real clips. */
export function parseShotEdits(input: unknown, shotCount: number, clips: Clip[]): ShotEdit[] | Fail {
  if (!Array.isArray(input) || input.length !== shotCount) return { status: 400, error: "invalid shots." };
  const byId = new Map(clips.filter((c) => c.status === "uploaded").map((c) => [c.id, c]));
  const out: ShotEdit[] = [];
  for (let i = 0; i < shotCount; i++) {
    const raw = input[i] as Record<string, unknown> | null;
    const clipId = raw?.clipId ?? null;
    if (clipId !== null && (typeof clipId !== "string" || !byId.has(clipId))) {
      return { status: 400, error: `shot ${i + 1} uses a clip that isn’t in this project.` };
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
    let start = num(raw?.trimStartS);
    let end = num(raw?.trimEndS);
    if (clipId === null) {
      start = end = null;
    } else if (start !== null || end !== null) {
      const duration = byId.get(clipId as string)!.durationS ?? Infinity;
      start ??= 0;
      end ??= duration;
      if (start < 0 || end > duration + 0.05 || end - start < MIN_SHOT_S) {
        return { status: 400, error: `shot ${i + 1}: the trim needs to be at least ${MIN_SHOT_S}s and inside the clip.` };
      }
    }
    out.push({ shotIndex: i, clipId: clipId as string | null, trimStartS: start, trimEndS: end });
  }
  return out;
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/**
 * Creates the next version and hands it to the processing engine.
 * Requirements are re-checked here (the browser can't be trusted).
 */
export async function startNewRender(
  userId: string,
  project: Project,
  build: (ctx: { shotCount: number; clips: Clip[] }) => RenderSettings | Fail,
): Promise<{ render: Render } | Fail> {
  const [inspo, clips] = await Promise.all([getInspiration(userId, project.id), listClips(userId, project.id)]);
  if (!inspo?.breakdown || inspo.status !== "ready") return { status: 400, error: "your inspo isn’t analyzed yet." };
  const uploaded = clips.filter((c) => c.status === "uploaded");
  if (!uploaded.length) return { status: 400, error: "upload at least one clip first." };
  if (!project.clipsRightsConfirmedAt) {
    return { status: 400, error: "please confirm you have permission to use your clips (step 2)." };
  }

  const settings = build({ shotCount: inspo.breakdown.shotCount, clips: uploaded });
  if ("error" in settings) return settings;

  const render = await createRender(project.id, settings);
  await submit(project.id, render, inspo.storageKey, inspo.breakdown, uploaded, settings);
  return { render };
}

/** Sends a render to the engine (also used by "try again"). */
export async function submit(
  projectId: string,
  render: Render,
  inspoKey: string,
  breakdown: NonNullable<Awaited<ReturnType<typeof getInspiration>>>["breakdown"],
  clips: Clip[],
  settings: RenderSettings,
) {
  try {
    const { jobId } = await startRender({
      projectId,
      renderId: render.id,
      version: render.version,
      inspo: { storageKey: inspoKey, breakdown: breakdown! },
      clips: clips.map((c) => ({
        id: c.id,
        storageKey: c.storageKey,
        durationS: c.durationS ?? 0,
        position: c.position,
        shotIndex: c.shotIndex,
      })),
      settings,
    });
    await setRenderJob(projectId, render.id, jobId);
  } catch (error) {
    console.error("Starting render failed:", error);
    await updateRender(projectId, render.id, {
      status: "failed",
      stage: null,
      progress: 0,
      error: "we couldn’t start your video. please try again.",
    });
  }
}

/** Restarts a failed render with the same settings (same version number). */
export async function retryRender(userId: string, project: Project, render: Render) {
  const [inspo, clips] = await Promise.all([getInspiration(userId, project.id), listClips(userId, project.id)]);
  if (!inspo?.breakdown) return { status: 400, error: "your inspo isn’t analyzed yet." } as Fail;
  const uploaded = clips.filter((c) => c.status === "uploaded");
  // Clips removed since: drop them from the shot list rather than failing.
  const ids = new Set(uploaded.map((c) => c.id));
  const settings: RenderSettings = {
    ...render.settings,
    shots: render.settings.shots.map((s) =>
      s.clipId && !ids.has(s.clipId) ? { ...s, clipId: null, trimStartS: null, trimEndS: null } : s,
    ),
  };
  await submit(project.id, render, inspo.storageKey, inspo.breakdown, uploaded, settings);
  return null;
}

/** Asks the engine how a render is going and saves the answer. */
export async function syncRender(projectId: string, render: Render): Promise<Render> {
  if (render.status === "done" || render.status === "failed" || !render.jobId) return render;
  const job = await getJobStatus(render.jobId);
  const status = job.state === "queued" ? "queued" : job.state;
  const update = {
    status,
    stage: job.stage,
    progress: job.progress,
    storageKey: job.output?.storageKey,
    postCopy: job.output?.postCopy,
    error: job.state === "failed" ? (job.error ?? "something went wrong while making your video.") : undefined,
  } as const;
  if (status !== render.status || job.stage !== render.stage || job.progress !== render.progress) {
    await updateRender(projectId, render.id, update);
  }
  return {
    ...render,
    status,
    stage: job.stage,
    progress: job.progress,
    storageKey: update.storageKey ?? render.storageKey,
    postCopy: update.postCopy ?? render.postCopy,
    error: update.error ?? null,
  };
}

export function settingsFor(options: VideoOptions, shots: ShotEdit[], seed = newSeed()): RenderSettings {
  return { options, shots, seed };
}
