import "server-only";
import { getSql } from "./db";
import type { Breakdown, RenderSettings, PostCopy, JobStage } from "./processing/types";
import { optionsFromJson, type VideoOptions } from "./video-options";

// Data access for the "create a video" flow. Every function takes the
// signed-in user's id and only ever touches that user's rows.

export type ProjectStatus = "draft" | "analyzing" | "ready_for_clips" | "processing" | "done" | "failed";

export interface Project {
  id: string;
  status: ProjectStatus;
  settings: VideoOptions;
  clipsRightsConfirmedAt: string | null;
  createdAt: string;
}

export interface Inspiration {
  id: string;
  storageKey: string;
  fileName: string | null;
  durationS: number | null;
  breakdown: Breakdown | null;
  status: "uploading" | "uploaded" | "analyzing" | "ready" | "failed";
  error: string | null;
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
    status: r.status as ProjectStatus,
    settings: optionsFromJson(r.settings),
    clipsRightsConfirmedAt: iso(r.clips_rights_confirmed_at),
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

function toRender(r: Row): Render {
  const result = r.result_json as { postCopy?: PostCopy } | null;
  return {
    id: String(r.id),
    version: Number(r.version),
    jobId: (r.job_id as string | null) ?? null,
    storageKey: (r.storage_key as string | null) ?? null,
    status: r.status as Render["status"],
    stage: (r.stage as JobStage | null) ?? null,
    progress: Number(r.progress),
    settings: r.settings as RenderSettings,
    postCopy: result?.postCopy ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: iso(r.created_at)!,
  };
}

export async function createProject(userId: string): Promise<Project> {
  const rows = await getSql()`INSERT INTO projects (user_id) VALUES (${userId}) RETURNING *`;
  return toProject(rows[0]);
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
  status: ProjectStatus;
  createdAt: string;
  inspoDurationS: number | null;
  shotCount: number | null;
  clipCount: number;
  latestVersion: number | null;
}

export async function listProjects(userId: string, limit = 20): Promise<ProjectSummary[]> {
  const rows = await getSql()`
    SELECT p.id, p.status, p.created_at,
           i.duration_s AS inspo_duration_s,
           (i.breakdown_json ->> 'shotCount')::int AS shot_count,
           (SELECT count(*) FROM clips c WHERE c.project_id = p.id AND c.status = 'uploaded')::int AS clip_count,
           (SELECT max(version) FROM renders r WHERE r.project_id = p.id) AS latest_version
    FROM projects p LEFT JOIN inspirations i ON i.project_id = p.id
    WHERE p.user_id = ${userId}
    ORDER BY p.created_at DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: String(r.id),
    status: r.status as ProjectStatus,
    createdAt: iso(r.created_at)!,
    inspoDurationS: num(r.inspo_duration_s),
    shotCount: num(r.shot_count),
    clipCount: Number(r.clip_count),
    latestVersion: num(r.latest_version),
  }));
}

/** Where "continue" should take the user for a project. */
export function resumeHref(p: { id: string; status: ProjectStatus }) {
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
        duration_s = EXCLUDED.duration_s, status = 'uploading', breakdown_json = NULL, error = NULL,
        style_reference_confirmed_at = now(), updated_at = now()
      RETURNING (SELECT storage_key FROM old) AS old_key`,
  ]);
  const old = rows[0]?.old_key as string | null | undefined;
  return old && old !== up.storageKey ? old : null;
}

/**
 * Marks the inspo as being checked and analyzed, unless that's already
 * happening (or done). Returns the inspo if this caller should do the work.
 * An "analyzing" state older than 2 minutes is treated as stuck and retried.
 */
export async function claimInspirationAnalysis(projectId: string): Promise<Inspiration | null> {
  const sql = getSql();
  const rows = await sql`
    UPDATE inspirations SET status = 'analyzing', error = NULL, updated_at = now()
    WHERE project_id = ${projectId}
      AND (status IN ('uploading', 'uploaded', 'failed')
           OR (status = 'analyzing' AND updated_at < now() - interval '2 minutes'))
    RETURNING *`;
  if (!rows[0]) return null;
  await sql`UPDATE projects SET status = 'analyzing', updated_at = now() WHERE id = ${projectId}`;
  return toInspiration(rows[0]);
}

export async function saveBreakdown(projectId: string, durationS: number, breakdown: Breakdown) {
  const sql = getSql();
  await sql.transaction([
    sql`UPDATE inspirations
        SET status = 'ready', duration_s = ${durationS}, breakdown_json = ${JSON.stringify(breakdown)}::jsonb,
            error = NULL, updated_at = now()
        WHERE project_id = ${projectId}`,
    sql`UPDATE projects SET status = 'ready_for_clips', updated_at = now()
        WHERE id = ${projectId} AND status IN ('draft', 'analyzing')`,
  ]);
}

export async function failInspiration(projectId: string, error: string, durationS: number | null = null) {
  const sql = getSql();
  await sql.transaction([
    sql`UPDATE inspirations
        SET status = 'failed', error = ${error}, duration_s = COALESCE(${durationS}, duration_s), updated_at = now()
        WHERE project_id = ${projectId}`,
    sql`UPDATE projects SET status = 'draft', updated_at = now() WHERE id = ${projectId}`,
  ]);
}
