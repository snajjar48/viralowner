import "server-only";
import { getSql } from "./db";
import type { Breakdown, InspoStyle, RenderSettings, PostCopy, JobStage, RenderPlan } from "./processing/types";
import { optionsFromJson, type VideoOptions } from "./video-options";

// Data access for the "create a video" flow. Every function takes the
// signed-in user's id and only ever touches that user's rows.

export type ProjectStatus = "draft" | "analyzing" | "ready_for_clips" | "processing" | "done" | "failed";
/** inspo: remake a viral video. scratch: "start from scratch" (Pro), the user's prompt instead of an inspo. */
export type ProjectKind = "inspo" | "scratch";

export interface Project {
  id: string;
  kind: ProjectKind;
  /** "Start from scratch": the video the user described. */
  prompt: string;
  status: ProjectStatus;
  settings: VideoOptions;
  /** The user has saved their own options (otherwise `settings` are the defaults). */
  settingsSaved: boolean;
  clipsRightsConfirmedAt: string | null;
  /** The user's own audio file, if they added one. */
  audio: ProjectAudio | null;
  /** How this video counted against the account (null until its first version starts). */
  billing: "trial" | "plan" | null;
  createdAt: string;
}

export interface ProjectAudio {
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationS: number | null;
  status: "uploading" | "uploaded";
  /** When the user accepted the audio rights notice. */
  rightsConfirmedAt: string;
}

export interface Inspiration {
  id: string;
  storageKey: string;
  fileName: string | null;
  durationS: number | null;
  breakdown: Breakdown | null;
  status: "uploading" | "uploaded" | "analyzing" | "ready" | "failed";
  error: string | null;
  /** The worker job analyzing it, while status is "analyzing". */
  analysisJobId: string | null;
}

export interface Clip {
  id: string;
  storageKey: string;
  fileName: string | null;
  sizeBytes: number | null;
  durationS: number | null;
  position: number;
  shotIndex: number | null;
  status: "uploading" | "uploaded" | "failed";
}

export interface Render {
  id: string;
  version: number;
  jobId: string | null;
  storageKey: string | null;
  status: "queued" | "processing" | "done" | "failed";
  stage: JobStage | null;
  progress: number;
  settings: RenderSettings;
  postCopy: PostCopy | null;
  /** What the engine chose (clip and trim per shot, the words), once done. */
  plan: RenderPlan | null;
  error: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

function toProject(r: Row): Project {
  return {
    id: String(r.id),
    kind: r.kind === "scratch" ? "scratch" : "inspo",
    prompt: typeof r.prompt === "string" ? r.prompt : "",
    status: r.status as ProjectStatus,
    settings: optionsFromJson(r.settings),
    settingsSaved: !!r.settings && typeof r.settings === "object" && Object.keys(r.settings).length > 0,
    clipsRightsConfirmedAt: iso(r.clips_rights_confirmed_at),
    audio: (r.audio as ProjectAudio | null) ?? null,
    billing: r.billing === "trial" || r.billing === "plan" ? r.billing : null,
    createdAt: iso(r.created_at)!,
  };
}

function toInspiration(r: Row): Inspiration {
  return {
    id: String(r.id),
    storageKey: String(r.storage_key),
    fileName: (r.file_name as string | null) ?? null,
    durationS: num(r.duration_s),
    breakdown: (r.breakdown_json as Breakdown | null) ?? null,
    status: r.status as Inspiration["status"],
    error: (r.error as string | null) ?? null,
    analysisJobId: (r.analysis_job_id as string | null) ?? null,
  };
}

function toClip(r: Row): Clip {
  return {
    id: String(r.id),
    storageKey: String(r.storage_key),
    fileName: (r.file_name as string | null) ?? null,
    sizeBytes: num(r.size_bytes),
    durationS: num(r.duration_s),
    position: Number(r.position),
    shotIndex: num(r.shot_index),
    status: r.status as Clip["status"],
  };
}

/** A request can change a version's caption style: its options show the style it really used. */
function withCaptionStyle(options: VideoOptions, used: RenderPlan["captionStyle"]): VideoOptions {
  if (!used) return options;
  return {
    ...options,
    captions: used === "off" ? { ...options.captions, enabled: false } : { enabled: true, style: used },
  };
}

function toRender(r: Row): Render {
  const result = r.result_json as { postCopy?: PostCopy; plan?: RenderPlan } | null;
  return {
    id: String(r.id),
    version: Number(r.version),
    jobId: (r.job_id as string | null) ?? null,
    storageKey: (r.storage_key as string | null) ?? null,
    status: r.status as Render["status"],
    stage: (r.stage as JobStage | null) ?? null,
    progress: Number(r.progress),
    // Older versions were saved before some options existed: fill in the defaults.
    settings: { ...(r.settings as RenderSettings), options: withCaptionStyle(optionsFromJson((r.settings as RenderSettings)?.options), result?.plan?.captionStyle) },
    postCopy: result?.postCopy ?? null,
    plan: result?.plan ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: iso(r.created_at)!,
  };
}

export async function createProject(userId: string): Promise<Project> {
  const rows = await getSql()`INSERT INTO projects (user_id) VALUES (${userId}) RETURNING *`;
  return toProject(rows[0]);
}

/** A "start from scratch" project: no inspo, the user's prompt. Starts with Claude writing any text. */
export async function createScratchProject(userId: string, prompt: string, options: VideoOptions): Promise<Project> {
  const rows = await getSql()`
    INSERT INTO projects (user_id, kind, prompt, settings)
    VALUES (${userId}, 'scratch', ${prompt}, ${JSON.stringify(options)}::jsonb) RETURNING *`;
  return toProject(rows[0]);
}

export async function saveProjectPrompt(projectId: string, prompt: string) {
  await getSql()`UPDATE projects SET prompt = ${prompt}, updated_at = now() WHERE id = ${projectId}`;
}

export async function getProject(userId: string, projectId: string): Promise<Project | null> {
  if (!isUuid(projectId)) return null;
  const rows = await getSql()`
    SELECT * FROM projects WHERE id = ${projectId} AND user_id = ${userId}`;
  return rows[0] ? toProject(rows[0]) : null;
}

export async function getInspiration(userId: string, projectId: string): Promise<Inspiration | null> {
  if (!isUuid(projectId)) return null;
  const rows = await getSql()`
    SELECT i.* FROM inspirations i JOIN projects p ON p.id = i.project_id
    WHERE i.project_id = ${projectId} AND p.user_id = ${userId}`;
  return rows[0] ? toInspiration(rows[0]) : null;
}

export async function listClips(userId: string, projectId: string): Promise<Clip[]> {
  if (!isUuid(projectId)) return [];
  const rows = await getSql()`
    SELECT c.* FROM clips c JOIN projects p ON p.id = c.project_id
    WHERE c.project_id = ${projectId} AND p.user_id = ${userId}
    ORDER BY c.position, c.created_at`;
  return rows.map(toClip);
}

/**
 * Everything the project's owner has asked for across their videos (additional requests and change requests),
 * oldest first, so new videos can follow their standing preferences.
 */
export async function requestHistory(projectId: string, limit = 60): Promise<string[]> {
  const rows = await getSql()`
    SELECT r.settings ->> 'request' AS request, r.settings -> 'options' ->> 'notes' AS notes
    FROM renders r JOIN projects p ON p.id = r.project_id
    WHERE p.user_id = (SELECT user_id FROM projects WHERE id = ${projectId})
    ORDER BY r.created_at DESC
    LIMIT 300`;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    for (const v of [r.request, r.notes]) {
      const text = typeof v === "string" ? v.trim() : "";
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push(text.slice(0, 500));
      }
    }
    if (out.length >= limit) break;
  }
  return out.reverse();
}

export async function listRenders(userId: string, projectId: string): Promise<Render[]> {
  if (!isUuid(projectId)) return [];
  const rows = await getSql()`
    SELECT r.* FROM renders r JOIN projects p ON p.id = r.project_id
    WHERE r.project_id = ${projectId} AND p.user_id = ${userId}
    ORDER BY r.version`;
  return rows.map(toRender);
}

export interface ProjectSummary {
  id: string;
  kind: ProjectKind;
  status: ProjectStatus;
  /** The name the user gave it ("" if none: see projectTitle). */
  name: string;
  /** "Start from scratch": the start of the prompt. */
  prompt: string;
  /** The first clip (its still is the project's cover). */
  coverClipKey: string | null;
  createdAt: string;
  updatedAt: string;
  inspoDurationS: number | null;
  shotCount: number | null;
  clipCount: number;
  latestVersion: number | null;
}

export async function listProjects(userId: string, limit = 60): Promise<ProjectSummary[]> {
  const rows = await getSql()`
    SELECT p.id, p.status, p.created_at, p.updated_at, to_jsonb(p) ->> 'kind' AS kind,
           coalesce(to_jsonb(p) ->> 'name', '') AS name, left(coalesce(to_jsonb(p) ->> 'prompt', ''), 120) AS prompt,
           (SELECT c.storage_key FROM clips c WHERE c.project_id = p.id AND c.status = 'uploaded'
             ORDER BY c.position LIMIT 1) AS cover_clip_key,
           i.duration_s AS inspo_duration_s,
           (i.breakdown_json ->> 'shotCount')::int AS shot_count,
           (SELECT count(*) FROM clips c WHERE c.project_id = p.id AND c.status = 'uploaded')::int AS clip_count,
           (SELECT max(version) FROM renders r WHERE r.project_id = p.id) AS latest_version
    FROM projects p LEFT JOIN inspirations i ON i.project_id = p.id
    WHERE p.user_id = ${userId}
    ORDER BY p.updated_at DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind === "scratch" ? "scratch" : "inspo",
    status: r.status as ProjectStatus,
    name: String(r.name ?? ""),
    prompt: String(r.prompt ?? ""),
    coverClipKey: r.cover_clip_key ? String(r.cover_clip_key) : null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at) ?? iso(r.created_at)!,
    inspoDurationS: num(r.inspo_duration_s),
    shotCount: num(r.shot_count),
    clipCount: Number(r.clip_count),
    latestVersion: num(r.latest_version),
  }));
}

export const PROJECT_NAME_MAX = 60;

/** What a project is called: its name, or one made from its prompt or date. */
export function projectTitle(p: Pick<ProjectSummary, "name" | "kind" | "prompt" | "createdAt">) {
  if (p.name.trim()) return p.name.trim();
  const prompt = p.prompt.replace(/\s+/g, " ").trim();
  if (p.kind === "scratch" && prompt) {
    const cut = prompt.length > 42 ? `${prompt.slice(0, 42).replace(/\s+\S*$/, "")}…` : prompt;
    return cut.charAt(0).toUpperCase() + cut.slice(1);
  }
  const day = new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return p.kind === "scratch" ? `New video · ${day}` : `Remake · ${day}`;
}

export async function renameProject(projectId: string, name: string) {
  await getSql()`UPDATE projects SET name = ${name} WHERE id = ${projectId}`;
}

/** Where "continue" should take the user for a project. */
export function resumeHref(p: { id: string; status: ProjectStatus; kind?: ProjectKind }) {
  if (p.kind === "scratch" && (p.status === "draft" || p.status === "analyzing" || p.status === "ready_for_clips")) {
    return `/projects/${p.id}/create`;
  }
  switch (p.status) {
    case "draft":
    case "analyzing":
      return `/projects/${p.id}/breakdown`;
    case "ready_for_clips":
      return `/projects/${p.id}/clips`;
    case "processing":
    case "failed":
      return `/projects/${p.id}/status`;
    case "done":
      return `/projects/${p.id}/preview`;
  }
}

// ---- Step 1: the inspo ----------------------------------------------------
// The functions below take a project id the caller has already checked
// belongs to the user (with getProject).

export interface InspoUpload {
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationS: number | null;
}

/**
 * Starts (or restarts) the inspo upload for a project. A new inspo means a new
 * shot list, so clip-to-shot assignments are cleared. Returns the previous
 * file's storage key so it can be deleted.
 */
export async function replaceInspiration(projectId: string, up: InspoUpload): Promise<string | null> {
  const sql = getSql();
  const [, , rows] = await sql.transaction([
    sql`UPDATE projects SET status = 'draft', updated_at = now() WHERE id = ${projectId}`,
    sql`UPDATE clips SET shot_index = NULL WHERE project_id = ${projectId}`,
    sql`
      WITH old AS (SELECT storage_key FROM inspirations WHERE project_id = ${projectId})
      INSERT INTO inspirations
        (project_id, storage_key, file_name, content_type, size_bytes, duration_s, status, style_reference_confirmed_at)
      VALUES
        (${projectId}, ${up.storageKey}, ${up.fileName}, ${up.contentType}, ${up.sizeBytes}, ${up.durationS}, 'uploading', now())
      ON CONFLICT (project_id) DO UPDATE SET
        storage_key = EXCLUDED.storage_key, file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes,
        duration_s = EXCLUDED.duration_s, status = 'uploading', breakdown_json = NULL, error = NULL, analysis_job_id = NULL,
        style_reference_confirmed_at = now(), updated_at = now()
      RETURNING (SELECT storage_key FROM old) AS old_key`,
  ]);
  const old = rows[0]?.old_key as string | null | undefined;
  return old && old !== up.storageKey ? old : null;
}

/**
 * Marks the inspo as being checked and analyzed, unless that's already
 * happening (or done). Returns the inspo if this caller should start the work.
 * An "analyzing" state with no job after 2 minutes is treated as stuck
 * (the request that claimed it died before starting the job) and retried.
 */
export async function claimInspirationAnalysis(projectId: string): Promise<Inspiration | null> {
  const sql = getSql();
  const rows = await sql`
    UPDATE inspirations SET status = 'analyzing', error = NULL, analysis_job_id = NULL, updated_at = now()
    WHERE project_id = ${projectId}
      AND (status IN ('uploading', 'uploaded', 'failed')
           OR (status = 'analyzing' AND analysis_job_id IS NULL AND updated_at < now() - interval '2 minutes'))
    RETURNING *`;
  if (!rows[0]) return null;
  await sql`UPDATE projects SET status = 'analyzing', updated_at = now() WHERE id = ${projectId}`;
  return toInspiration(rows[0]);
}

/** Records the worker job analyzing this inspo. */
export async function setInspirationJob(projectId: string, jobId: string, durationS: number) {
  await getSql()`
    UPDATE inspirations SET analysis_job_id = ${jobId}, duration_s = ${durationS}, updated_at = now()
    WHERE project_id = ${projectId} AND status = 'analyzing'`;
}

/**
 * Saves a finished analysis. With `jobId`, only if that job is still the one
 * on record (the user may have uploaded a different inspo meanwhile).
 */
export async function saveBreakdown(projectId: string, durationS: number, breakdown: Breakdown, jobId?: string) {
  const sql = getSql();
  const job = jobId ?? null;
  const rows = await sql`
    UPDATE inspirations
    SET status = 'ready', duration_s = ${durationS}, breakdown_json = ${JSON.stringify(breakdown)}::jsonb,
        error = NULL, analysis_job_id = NULL, updated_at = now()
    WHERE project_id = ${projectId} AND (${job}::text IS NULL OR analysis_job_id = ${job})
    RETURNING id`;
  if (!rows.length) return false;
  await sql`UPDATE projects SET status = 'ready_for_clips', updated_at = now()
            WHERE id = ${projectId} AND status IN ('draft', 'analyzing')`;
  return true;
}

export async function failInspiration(projectId: string, error: string, durationS: number | null = null, jobId?: string) {
  const sql = getSql();
  const job = jobId ?? null;
  const rows = await sql`
    UPDATE inspirations
    SET status = 'failed', error = ${error}, duration_s = COALESCE(${durationS}, duration_s),
        analysis_job_id = NULL, updated_at = now()
    WHERE project_id = ${projectId} AND (${job}::text IS NULL OR analysis_job_id = ${job})
    RETURNING id`;
  if (!rows.length) return false;
  await sql`UPDATE projects SET status = 'draft', updated_at = now() WHERE id = ${projectId}`;
  return true;
}

// ---- Step 2: clips ---------------------------------------------------------

export interface ClipUpload {
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationS: number | null;
}

/** Adds a clip at the end, unless the project already has `max` clips. */
export async function createClip(projectId: string, up: ClipUpload, max: number): Promise<Clip | null> {
  const rows = await getSql()`
    INSERT INTO clips (project_id, storage_key, file_name, content_type, size_bytes, duration_s, position, status)
    SELECT ${projectId}, ${up.storageKey}, ${up.fileName}, ${up.contentType}, ${up.sizeBytes}, ${up.durationS},
           COALESCE((SELECT max(position) + 1 FROM clips WHERE project_id = ${projectId}), 0), 'uploading'
    WHERE (SELECT count(*) FROM clips WHERE project_id = ${projectId} AND status <> 'failed') < ${max}
    RETURNING *`;
  return rows[0] ? toClip(rows[0]) : null;
}

export async function getClip(projectId: string, clipId: string): Promise<Clip | null> {
  if (!isUuid(clipId)) return null;
  const rows = await getSql()`SELECT * FROM clips WHERE id = ${clipId} AND project_id = ${projectId}`;
  return rows[0] ? toClip(rows[0]) : null;
}

export async function markClipUploaded(clipId: string, durationS: number, sizeBytes: number) {
  await getSql()`
    UPDATE clips SET status = 'uploaded', duration_s = ${durationS}, size_bytes = ${sizeBytes} WHERE id = ${clipId}`;
}

export async function markClipFailed(clipId: string) {
  await getSql()`UPDATE clips SET status = 'failed', shot_index = NULL WHERE id = ${clipId}`;
}

/** Deletes a clip row; returns its storage key so the file can be deleted. */
export async function deleteClip(projectId: string, clipId: string): Promise<string | null> {
  if (!isUuid(clipId)) return null;
  const rows = await getSql()`
    DELETE FROM clips WHERE id = ${clipId} AND project_id = ${projectId} RETURNING storage_key`;
  return (rows[0]?.storage_key as string | undefined) ?? null;
}

/** Saves a new clip order (ids not in the project are ignored). */
export async function reorderClips(projectId: string, clipIds: string[]) {
  await getSql()`
    UPDATE clips SET position = o.pos
    FROM unnest(${clipIds}::uuid[]) WITH ORDINALITY AS o(id, pos)
    WHERE clips.id = o.id AND clips.project_id = ${projectId}`;
}

/** Puts a clip on a shot (one clip per shot), or takes it off (null). */
export async function assignClip(projectId: string, clipId: string, shotIndex: number | null) {
  const sql = getSql();
  if (shotIndex === null) {
    await sql`UPDATE clips SET shot_index = NULL WHERE id = ${clipId} AND project_id = ${projectId}`;
    return;
  }
  await sql.transaction([
    sql`UPDATE clips SET shot_index = NULL WHERE project_id = ${projectId} AND shot_index = ${shotIndex}`,
    sql`UPDATE clips SET shot_index = ${shotIndex} WHERE id = ${clipId} AND project_id = ${projectId} AND status = 'uploaded'`,
  ]);
}

export async function confirmClipRights(projectId: string) {
  await getSql()`
    UPDATE projects SET clips_rights_confirmed_at = now(), updated_at = now() WHERE id = ${projectId}`;
}

// ---- Step 3: options ------------------------------------------------------

export async function saveSettings(projectId: string, options: VideoOptions) {
  await getSql()`
    UPDATE projects SET settings = ${JSON.stringify(options)}::jsonb, updated_at = now() WHERE id = ${projectId}`;
}

/** Sets (or clears) the project's own audio file. Returns the previous file's key, to delete. */
export async function setProjectAudio(projectId: string, audio: ProjectAudio | null): Promise<string | null> {
  const rows = await getSql()`
    WITH old AS (SELECT audio FROM projects WHERE id = ${projectId})
    UPDATE projects SET audio = ${audio ? JSON.stringify(audio) : null}::jsonb, updated_at = now()
    WHERE id = ${projectId}
    RETURNING (SELECT audio->>'storageKey' FROM old) AS old_key`;
  return (rows[0]?.old_key as string | null) ?? null;
}

// ---- Renders (versions of the finished video) ------------------------------

export async function getRender(projectId: string, renderId: string): Promise<Render | null> {
  if (!isUuid(renderId)) return null;
  const rows = await getSql()`SELECT * FROM renders WHERE id = ${renderId} AND project_id = ${projectId}`;
  return rows[0] ? toRender(rows[0]) : null;
}

/** A render that's still being made (queued or processing), if any. */
export async function getActiveRender(projectId: string): Promise<Render | null> {
  const rows = await getSql()`
    SELECT * FROM renders
    WHERE project_id = ${projectId} AND status IN ('queued', 'processing')
      AND updated_at > now() - interval '30 minutes'
    ORDER BY version DESC LIMIT 1`;
  return rows[0] ? toRender(rows[0]) : null;
}

/** Adds the next version (1, 2, 3…) as a queued render. */
export async function createRender(projectId: string, settings: RenderSettings): Promise<Render> {
  const sql = getSql();
  for (let attempt = 0; ; attempt++) {
    try {
      const rows = await sql`
        INSERT INTO renders (project_id, version, settings, status)
        VALUES (${projectId},
                COALESCE((SELECT max(version) + 1 FROM renders WHERE project_id = ${projectId}), 1),
                ${JSON.stringify(settings)}::jsonb, 'queued')
        RETURNING *`;
      return toRender(rows[0]);
    } catch (error) {
      // Two renders started at the same moment: retry with the next number.
      if (attempt < 2 && (error as { code?: string }).code === "23505") continue;
      throw error;
    }
  }
}

/** The engine accepted the job. */
export async function setRenderJob(projectId: string, renderId: string, jobId: string) {
  const sql = getSql();
  await sql.transaction([
    sql`UPDATE renders
        SET job_id = ${jobId}, status = 'processing', stage = 'analyzing', progress = 0, error = NULL,
            storage_key = NULL, completed_at = NULL, updated_at = now()
        WHERE id = ${renderId}`,
    sql`UPDATE projects SET status = 'processing', updated_at = now() WHERE id = ${projectId}`,
  ]);
}

export interface RenderUpdate {
  status: Render["status"];
  stage: JobStage | null;
  progress: number;
  storageKey?: string;
  postCopy?: PostCopy;
  plan?: RenderPlan;
  error?: string;
}

/**
 * Saves the engine's latest status. The project's status follows its newest
 * version (an older version finishing doesn't change it).
 */
export async function updateRender(projectId: string, renderId: string, u: RenderUpdate) {
  const sql = getSql();
  const finished = u.status === "done" || u.status === "failed";
  const projectStatus = u.status === "done" ? "done" : u.status === "failed" ? "failed" : "processing";
  await sql.transaction([
    sql`UPDATE renders
        SET status = ${u.status}, stage = ${u.stage}, progress = ${u.progress},
            storage_key = COALESCE(${u.storageKey ?? null}, storage_key),
            result_json = COALESCE(${u.postCopy ? JSON.stringify({ postCopy: u.postCopy, plan: u.plan }) : null}::jsonb, result_json),
            error = ${u.error ?? null},
            completed_at = CASE WHEN ${finished} THEN now() ELSE NULL END,
            updated_at = now()
        WHERE id = ${renderId}`,
    sql`UPDATE projects SET status = ${projectStatus}, updated_at = now()
        WHERE id = ${projectId}
          AND (SELECT max(version) FROM renders WHERE project_id = ${projectId})
              = (SELECT version FROM renders WHERE id = ${renderId})`,
  ]);
}

/** Adds the inspo's editing style to a breakdown made before style analysis existed. */
export async function saveInspoStyle(projectId: string, style: InspoStyle) {
  await getSql()`
    UPDATE inspirations
    SET breakdown_json = jsonb_set(breakdown_json, '{style}', ${JSON.stringify(style)}::jsonb), updated_at = now()
    WHERE project_id = ${projectId} AND breakdown_json IS NOT NULL AND NOT (breakdown_json ? 'style')`;
}
