import "server-only";
import { categoryLabel, isCategory, VIDEO_CATEGORIES, type VideoCategory } from "./categories";
import { getSql } from "./db";
import { workerFetch } from "./worker";

/**
 * The editor learns from everyone: each day the recent change requests, notes and feedback are
 * turned into general lessons (no personal details), and every new version is made with them.
 * Each kind of video (lib/categories.ts) also learns on its own, from the videos made in it: those
 * lessons go with that category's videos, next to the general ones.
 */

async function latestFor(category: VideoCategory | null): Promise<string[]> {
  const sql = getSql();
  const rows = category
    ? await sql`SELECT lessons FROM editor_lessons WHERE category = ${category} ORDER BY created_at DESC LIMIT 1`
    : await sql`SELECT lessons FROM editor_lessons WHERE to_jsonb(editor_lessons) ->> 'category' IS NULL ORDER BY created_at DESC LIMIT 1`;
  return (rows[0]?.lessons as string[] | undefined) ?? [];
}

/** The latest lessons, as lines to send with a render (the category's own after the general ones); "" if none yet. */
export async function latestLessons(category?: string | null): Promise<string> {
  try {
    const cat = isCategory(category) ? category : null;
    const [general, own] = await Promise.all([latestFor(null), cat ? latestFor(cat).catch(() => []) : Promise.resolve([])]);
    const lines = general.map((l) => `- ${l}`);
    if (own.length) lines.push(`for ${categoryLabel(cat)} videos (this one is):`, ...own.map((l) => `- ${l}`));
    return lines.join("\n");
  } catch {
    return ""; // before the migration runs
  }
}

export type LessonSet = { lessons: string[]; count: number; createdAt: string };

export async function lessonsHistory(limit = 5): Promise<LessonSet[]> {
  try {
    const rows = await getSql()`
      SELECT lessons, source_count, created_at FROM editor_lessons e
      WHERE to_jsonb(e) ->> 'category' IS NULL ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map(toSet);
  } catch {
    return [];
  }
}

/** Each category's latest lessons (admin dashboard). */
export async function categoryLessons(): Promise<Partial<Record<VideoCategory, LessonSet>>> {
  try {
    const rows = await getSql()`
      SELECT DISTINCT ON (category) category, lessons, source_count, created_at FROM editor_lessons
      WHERE category IS NOT NULL ORDER BY category, created_at DESC`;
    return Object.fromEntries(rows.filter((r) => isCategory(r.category)).map((r) => [r.category, toSet(r)]));
  } catch {
    return {};
  }
}

const toSet = (r: Record<string, unknown>): LessonSet => ({
  lessons: (r.lessons as string[]) ?? [],
  count: Number(r.source_count ?? 0),
  createdAt: new Date(r.created_at as string).toISOString(),
});

/** What people asked for and said recently (last 60 days): everyone's, or only in videos of one category. */
async function recentWords(category: VideoCategory | null): Promise<string[]> {
  const sql = getSql();
  const asks = category
    ? await sql`
      SELECT DISTINCT ON (txt) txt FROM (
        SELECT 'asked for a change: ' || (r.settings ->> 'request') txt FROM renders r JOIN projects p ON p.id = r.project_id
        WHERE p.category = ${category} AND coalesce(r.settings ->> 'request', '') <> '' AND r.created_at > now() - interval '60 days'
        UNION ALL
        SELECT 'notes before the first version: ' || (r.settings -> 'options' ->> 'notes') txt FROM renders r JOIN projects p ON p.id = r.project_id
        WHERE p.category = ${category} AND coalesce(r.settings -> 'options' ->> 'notes', '') <> '' AND r.created_at > now() - interval '60 days'
        UNION ALL
        SELECT 'what they described for a video from scratch: ' || p.prompt txt FROM projects p
        WHERE p.category = ${category} AND p.kind = 'scratch' AND coalesce(p.prompt, '') <> '' AND p.created_at > now() - interval '60 days'
      ) x ORDER BY txt LIMIT 1200`
    : await sql`
      SELECT DISTINCT ON (txt) txt FROM (
        SELECT 'asked for a change: ' || (settings ->> 'request') txt, created_at FROM renders
        WHERE coalesce(settings ->> 'request', '') <> '' AND created_at > now() - interval '60 days'
        UNION ALL
        SELECT 'notes before the first version: ' || (settings -> 'options' ->> 'notes') txt, created_at FROM renders
        WHERE coalesce(settings -> 'options' ->> 'notes', '') <> '' AND created_at > now() - interval '60 days'
      ) x ORDER BY txt LIMIT 1200`;
  const feedback = category
    ? await sql`
      SELECT 'feedback on a finished video (' || coalesce(f.rating, 'no rating') || '): ' || f.message txt
      FROM feedback f JOIN projects p ON p.id = f.project_id
      WHERE p.category = ${category} AND f.created_at > now() - interval '60 days' AND (f.message <> '' OR f.rating = 'not_quite')
      ORDER BY f.created_at DESC LIMIT 300`.catch(() => [])
    : await sql`
      SELECT 'feedback on a finished video (' || coalesce(rating, 'no rating') || '): ' || message txt FROM feedback
      WHERE created_at > now() - interval '60 days' AND (message <> '' OR rating = 'not_quite')
      ORDER BY created_at DESC LIMIT 300`.catch(() => []);
  return [...asks, ...feedback].map((r) => String(r.txt));
}

/** One set of lessons (general, or one category's). */
async function learn(category: VideoCategory | null, deadline: number): Promise<{ lessons: number; from: number }> {
  const items = await recentWords(category);
  if (items.length < 5) return { lessons: 0, from: items.length };
  const { jobId } = await workerFetch<{ jobId: string }>("/jobs/lessons", {
    method: "POST",
    body: { items, category },
    timeoutMs: 30_000,
  });
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const job = await workerFetch<{ state: string; output?: { lessons?: unknown }; error?: string }>(`/jobs/${encodeURIComponent(jobId)}`);
    if (job.state === "failed") throw new Error(job.error ?? "lessons job failed");
    if (job.state !== "done") continue;
    const lessons = Array.isArray(job.output?.lessons)
      ? job.output.lessons.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 20)
      : [];
    if (lessons.length) {
      if (category) {
        await getSql()`INSERT INTO editor_lessons (lessons, source_count, category) VALUES (${lessons}, ${items.length}, ${category})`;
      } else {
        await getSql()`INSERT INTO editor_lessons (lessons, source_count) VALUES (${lessons}, ${items.length})`;
      }
    }
    return { lessons: lessons.length, from: items.length };
  }
  throw new Error("lessons job took too long");
}

/** Makes today's lessons: for every video, and for each category (all at once, a few minutes). */
export async function learnFromEveryone(deadline: number) {
  const runs = [null, ...VIDEO_CATEGORIES.map((c) => c.id)] as (VideoCategory | null)[];
  const results = await Promise.allSettled(runs.map((c) => learn(c, deadline)));
  const out: Record<string, { lessons: number; from: number } | { error: string }> = {};
  results.forEach((r, i) => {
    out[runs[i] ?? "everyone"] = r.status === "fulfilled" ? r.value : { error: String(r.reason?.message ?? r.reason) };
  });
  if (results[0].status === "rejected") throw results[0].reason;
  return out;
}
