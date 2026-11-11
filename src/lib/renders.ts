import "server-only";
import { getJobStatus, startRender, type RenderInput, type RenderSettings, type ShotEdit } from "./processing";
import {
  createRender,
  getActiveRender,
  getInspiration,
  listClips,
  listRenders,
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
type Extras = Pick<RenderInput, "reuseText" | "fresh" | "request" | "previous">;

export async function startNewRender(
  userId: string,
  project: Project,
  build: (ctx: { shotCount: number; clips: Clip[] }) => RenderSettings | Fail,
  extras: Extras = {},
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
  await submit(project.id, render, inspo.storageKey, inspo.breakdown, uploaded, settings, extras);
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
  extras: Extras = {},
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
      ...extras,
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
  let extras: Extras = {};
  if (settings.request && settings.fromVersion) {
    const from = (await listRenders(userId, project.id)).find((r) => r.version === settings.fromVersion);
    const previous = from && previousFor(from, settings.options);
    if (previous) extras = { request: settings.request, previous };
  }
  await submit(project.id, render, inspo.storageKey, inspo.breakdown, uploaded, settings, extras);
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
    plan: job.output?.plan,
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
    plan: update.plan ?? render.plan,
    error: update.error ?? null,
  };
}

/**
 * Renders only move forward when someone asks the engine about them, so a
 * version whose status page was closed can look "in progress" long after it
 * finished. Bring unfinished ones up to date before relying on their status.
 */
export async function syncUnfinished(projectId: string, renders: Render[]): Promise<Render[]> {
  return Promise.all(
    renders.map((r) =>
      r.status === "queued" || r.status === "processing"
        ? syncRender(projectId, r).catch((error) => {
            console.error("Checking render failed:", error);
            return r;
          })
        : r,
    ),
  );
}

/** The version still being made (after checking with the engine), or null. */
export async function getStillActiveRender(projectId: string): Promise<Render | null> {
  const active = await getActiveRender(projectId);
  if (!active) return null;
  const [synced] = await syncUnfinished(projectId, [active]);
  return synced.status === "queued" || synced.status === "processing" ? synced : null;
}

/**
 * An edit that leaves the text options alone keeps the earlier version's
 * words (on-screen text, caption, hashtags) instead of writing new ones.
 */
export function textToReuse(from: Render | undefined, options: VideoOptions): Extras["reuseText"] {
  if (!from?.plan || !from.postCopy || textChanged(from, options)) return undefined;
  const { texts, textPosition, textLook, textYs, captionYs, textScale, captionScale } = from.plan;
  return { texts, textPosition, textLook, textYs, captionYs, textScale, captionScale, postCopy: from.postCopy };
}

/** The words depend on the text options and the additional requests. */
function textChanged(from: Render, options: VideoOptions) {
  const before = from.settings.options;
  return JSON.stringify(before.text) !== JSON.stringify(options.text) || (before.notes ?? "") !== options.notes;
}

/** What "request a change" needs to know about the version being changed. */
export function previousFor(from: Render, options: VideoOptions): Extras["previous"] | null {
  if (!from.plan || !from.storageKey?.startsWith("u/")) return null;
  return { storageKey: from.storageKey, plan: from.plan, postCopy: from.postCopy, textChanged: textChanged(from, options) };
}

export function settingsFor(options: VideoOptions, shots: ShotEdit[], seed = newSeed()): RenderSettings {
  return { options, shots, seed };
}
