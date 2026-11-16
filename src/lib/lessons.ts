import "server-only";
import { getSql } from "./db";
import { workerFetch } from "./worker";

/**
 * The editor learns from everyone: each day the recent change requests, notes and feedback are
 * turned into general lessons (no personal details), and every new version is made with them.
 */

/** The latest lessons, as lines to send with a render; "" if there are none yet. */
export async function latestLessons(): Promise<string> {
  try {
    const rows = await getSql()`SELECT lessons FROM editor_lessons ORDER BY created_at DESC LIMIT 1`;
    const lessons = (rows[0]?.lessons as string[] | undefined) ?? [];
    return lessons.map((l) => `- ${l}`).join("\n");
  } catch {
    return ""; // before the migration runs
  }
}

export async function lessonsHistory(limit = 5) {
  try {
    const rows = await getSql()`SELECT lessons, source_count, created_at FROM editor_lessons ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map((r) => ({
      lessons: (r.lessons as string[]) ?? [],
      count: Number(r.source_count ?? 0),
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  } catch {
    return [];
  }
}

/** What people asked for and said recently (last 60 days), everyone's. */
async function recentWords(): Promise<string[]> {
  const sql = getSql();
  const asks = await sql`
    SELECT DISTINCT ON (txt) txt FROM (
      SELECT 'asked for a change: ' || (settings ->> 'request') txt, created_at FROM renders
      WHERE coalesce(settings ->> 'request', '') <> '' AND created_at > now() - interval '60 days'
      UNION ALL
      SELECT 'notes before the first version: ' || (settings -> 'options' ->> 'notes') txt, created_at FROM renders
      WHERE coalesce(settings -> 'options' ->> 'notes', '') <> '' AND created_at > now() - interval '60 days'
    ) x ORDER BY txt LIMIT 1200`;
  const feedback = await sql`
    SELECT 'feedback on a finished video (' || coalesce(rating, 'no rating') || '): ' || message txt FROM feedback
    WHERE created_at > now() - interval '60 days' AND (message <> '' OR rating = 'not_quite')
    ORDER BY created_at DESC LIMIT 300`.catch(() => []);
  return [...asks, ...feedback].map((r) => String(r.txt));
}

/** Makes today's lessons (a few minutes). Returns how many it learned. */
export async function learnFromEveryone(deadline: number): Promise<{ lessons: number; from: number }> {
  const items = await recentWords();
  if (items.length < 5) return { lessons: 0, from: items.length };
  const { jobId } = await workerFetch<{ jobId: string }>("/jobs/lessons", { method: "POST", body: { items }, timeoutMs: 30_000 });
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const job = await workerFetch<{ state: string; output?: { lessons?: unknown }; error?: string }>(`/jobs/${encodeURIComponent(jobId)}`);
    if (job.state === "failed") throw new Error(job.error ?? "lessons job failed");
    if (job.state !== "done") continue;
    const lessons = Array.isArray(job.output?.lessons)
      ? job.output.lessons.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 20)
      : [];
    if (lessons.length) {
      await getSql()`INSERT INTO editor_lessons (lessons, source_count) VALUES (${lessons}, ${items.length})`;
    }
    return { lessons: lessons.length, from: items.length };
  }
  throw new Error("lessons job took too long");
}
