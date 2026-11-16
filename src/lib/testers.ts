import "server-only";
import { getSql } from "./db";
import { createAdminClient } from "./supabase/server";

/**
 * Free testers: emails the owner adds in the admin dashboard. An account with one of them gets
 * full access (no plan, trial or card), like the owner (lib/membership.ts). Removing it ends that.
 */

export const TESTER_NOTE_MAX = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const cleanEmail = (v: unknown) => {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
};

/** Whether this email is a tester (false before the testers migration runs). */
export async function isTester(email: string | null | undefined): Promise<boolean> {
  const e = cleanEmail(email);
  if (!e) return false;
  try {
    const rows = await getSql()`SELECT 1 FROM testers WHERE email = ${e}`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export type TesterRow = {
  email: string;
  note: string;
  addedAt: string;
  /** Their account, once they've signed up. */
  userId: string | null;
  projects: number;
  versions: number;
  lastActive: string | null;
};

/** Every tester, with whether they've signed up and what they've made. Null before the migration runs. */
export async function listTesters(): Promise<TesterRow[] | null> {
  let rows;
  try {
    rows = await getSql()`SELECT email, note, added_at FROM testers ORDER BY added_at DESC`;
  } catch {
    return null;
  }
  const emails = rows.map((r) => String(r.email));
  const { data: profiles } = emails.length
    ? await createAdminClient().from("profiles").select("id, email").in("email", emails)
    : { data: [] as { id: string; email: string }[] };
  const idOf = new Map((profiles ?? []).map((p) => [String(p.email).toLowerCase(), String(p.id)]));
  const ids = [...idOf.values()];
  const usage = ids.length
    ? await getSql()`
        SELECT p.user_id, count(DISTINCT p.id)::int projects, count(r.id) FILTER (WHERE r.status = 'done')::int versions,
               max(greatest(p.updated_at, coalesce(r.created_at, p.updated_at))) last_active
        FROM projects p LEFT JOIN renders r ON r.project_id = p.id
        WHERE p.user_id = ANY(${ids}::uuid[]) GROUP BY p.user_id`
    : [];
  const byUser = new Map(usage.map((u) => [String(u.user_id), u]));
  return rows.map((r) => {
    const userId = idOf.get(String(r.email)) ?? null;
    const u = userId ? byUser.get(userId) : undefined;
    return {
      email: String(r.email),
      note: String(r.note ?? ""),
      addedAt: new Date(r.added_at as string).toISOString(),
      userId,
      projects: Number(u?.projects ?? 0),
      versions: Number(u?.versions ?? 0),
      lastActive: u?.last_active ? new Date(u.last_active as string).toISOString() : null,
    };
  });
}

export async function addTester(email: string, note: string) {
  await getSql()`
    INSERT INTO testers (email, note) VALUES (${email}, ${note})
    ON CONFLICT (email) DO UPDATE SET note = EXCLUDED.note`;
}

export async function removeTester(email: string) {
  await getSql()`DELETE FROM testers WHERE email = ${email}`;
}
