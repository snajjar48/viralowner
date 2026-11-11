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
