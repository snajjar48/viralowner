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
        UNION ALL
        SELECT 'what they described for a video from scratch: ' || prompt txt, created_at FROM projects
        WHERE kind = 'scratch' AND coalesce(prompt, '') <> '' AND created_at > now() - interval '60 days'
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
  // What the editor's own check caught before the user saw it (fixed then, but the first try should be right).
  const misses = category
    ? await sql`
      SELECT 'the editor got this wrong on its first try (caught and fixed before the user saw it): ' || m txt
      FROM renders r JOIN projects p ON p.id = r.project_id,
           jsonb_array_elements_text(coalesce(r.result_json -> 'plan' -> 'reviewMisses', '[]'::jsonb)) m
      WHERE p.category = ${category} AND r.created_at > now() - interval '60 days'
      ORDER BY r.created_at DESC LIMIT 300`.catch(() => [])
    : await sql`
      SELECT 'the editor got this wrong on its first try (caught and fixed before the user saw it): ' || m txt
      FROM renders r, jsonb_array_elements_text(coalesce(r.result_json -> 'plan' -> 'reviewMisses', '[]'::jsonb)) m
      WHERE r.created_at > now() - interval '60 days'
      ORDER BY r.created_at DESC LIMIT 300`.catch(() => []);
  const edits = await handEdits(category).catch(() => []);
  return [...[...asks, ...feedback, ...misses].map((r) => String(r.txt)), ...edits];
}

type Item = { text?: string; start?: number; end?: number; y?: number | null; size?: number; font?: string | null; color?: string | null; look?: string | null };
type Settings = {
  options?: { captions?: { enabled?: boolean; style?: string }; text?: { style?: string; align?: string; mode?: string }; music?: { mode?: string } };
  carry?: { textItems?: Item[]; captionFixes?: { wrong: string; right: string }[] };
  shots?: { trimStartS?: number | null; trimEndS?: number | null }[];
  request?: string | null;
};

/** What people changed by hand in the editor (versions made without a written request), in plain words:
 * each version compared with the one before it. These show what the editor keeps getting wrong. */
async function handEdits(category: VideoCategory | null): Promise<string[]> {
  const sql = getSql();
  const rows = category
    ? await sql`
      SELECT r.settings, prev.settings prev_settings, prev.result_json -> 'plan' prev_plan
      FROM renders r JOIN projects p ON p.id = r.project_id
      JOIN renders prev ON prev.project_id = r.project_id AND prev.version = r.version - 1
      WHERE p.category = ${category} AND r.created_at > now() - interval '60 days' AND coalesce(r.settings ->> 'request', '') = ''
      ORDER BY r.created_at DESC LIMIT 400`
    : await sql`
      SELECT r.settings, prev.settings prev_settings, prev.result_json -> 'plan' prev_plan
      FROM renders r JOIN renders prev ON prev.project_id = r.project_id AND prev.version = r.version - 1
      WHERE r.created_at > now() - interval '60 days' AND coalesce(r.settings ->> 'request', '') = ''
      ORDER BY r.created_at DESC LIMIT 400`;
  const out: string[] = [];
  for (const row of rows) {
    const now = (row.settings ?? {}) as Settings;
    const before = (row.prev_settings ?? {}) as Settings;
    const plan = (row.prev_plan ?? {}) as { textItems?: Item[]; shots?: { trimStartS?: number | null; trimEndS?: number | null }[] };
    const did: string[] = [];
    const o = now.options ?? {}, b = before.options ?? {};
    if (o.captions?.enabled !== b.captions?.enabled && b.captions) did.push(o.captions?.enabled ? "turned captions on" : "turned captions off");
    else if (o.captions?.style && b.captions?.style && o.captions.style !== b.captions.style)
      did.push(`changed the caption style from ${b.captions.style} to ${o.captions.style}`);
    if (o.text?.style && b.text?.style && o.text.style !== b.text.style) did.push(`changed the text look from ${b.text.style} to ${o.text.style}`);
    if (o.text?.align && b.text?.align && o.text.align !== b.text.align) did.push(`aligned the text ${o.text.align}`);
    if (o.music?.mode && b.music?.mode && o.music.mode !== b.music.mode) did.push(`changed the sound from ${b.music.mode} to ${o.music.mode}`);
    const fixes = (now.carry?.captionFixes ?? []).filter(
      (f) => !(before.carry?.captionFixes ?? []).some((g) => g.wrong === f.wrong && g.right === f.right),
    );
    for (const f of fixes.slice(0, 4)) did.push(`corrected a caption word: "${f.wrong}" → "${f.right}"`);
    const items = now.carry?.textItems;
    const was = before.carry?.textItems ?? plan.textItems;
    if (Array.isArray(items) && Array.isArray(was)) {
      if (!items.length && was.length) did.push("removed all the on-screen text");
      const end = Math.max(0, ...was.map((x) => x.end ?? 0));
      items.slice(0, 6).forEach((it, k) => {
        const w = was.find((x) => x.text === it.text) ?? was[k];
        if (!w) return void did.push(`added on-screen text "${(it.text ?? "").slice(0, 60)}"`);
        if (w.text !== it.text) did.push(`rewrote on-screen text "${(w.text ?? "").slice(0, 50)}" as "${(it.text ?? "").slice(0, 50)}"`);
        if (typeof it.y === "number" && typeof w.y === "number" && Math.abs(it.y - w.y) > 0.08)
          did.push(it.y < w.y ? "moved the on-screen text up" : "moved the on-screen text down");
        if ((it.size ?? 1) > (w.size ?? 1) * 1.1) did.push("made the on-screen text bigger");
        if ((it.size ?? 1) < (w.size ?? 1) * 0.9) did.push("made the on-screen text smaller");
        if (it.font && it.font !== w.font) did.push(`changed the text font to ${it.font}`);
        if (it.look && it.look !== w.look) did.push(`changed the text look to ${it.look}`);
        if ((it.end ?? 0) - (it.start ?? 0) > (w.end ?? 0) - (w.start ?? 0) + 1 && (it.start ?? 1) < 0.2 && (it.end ?? 0) >= end - 0.3)
          did.push("kept the text on screen for the whole video");
      });
    }
    const shots = now.shots ?? [], old = plan.shots ?? [];
    if (old.length && shots.length && shots.length < old.length) did.push(`deleted ${old.length - shots.length} shot(s)`);
    const retimed = shots.filter((s, i) => old[i] && (Math.abs((s.trimStartS ?? 0) - (old[i].trimStartS ?? 0)) > 0.2
      || Math.abs((s.trimEndS ?? 0) - (old[i].trimEndS ?? 0)) > 0.2)).length;
    if (retimed) did.push(`re-trimmed ${retimed} shot(s) by hand`);
    const unique = [...new Set(did)];
    if (unique.length) out.push("edited by hand in the editor (without asking): " + unique.join("; "));
  }
  return out;
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
