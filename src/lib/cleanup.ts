import "server-only";
import { getSql } from "./db";
import { deletePrefix } from "./storage";

/** Drafts (no version ever made) are deleted after this many days without being opened or changed. */
export const DRAFT_DAYS = 30;

/**
 * Deletes drafts nobody has opened or changed in DRAFT_DAYS: projects that never made a version
 * (so they never counted toward a plan or the free trial), with all their files. Videos that were
 * made are never touched. Returns what it deleted.
 */
export async function cleanUpDrafts(limit = 100): Promise<{ projects: number; files: number; failed: number }> {
  const sql = getSql();
  // The row goes first, in one statement that re-checks it's still untouched, so a draft opened
  // a moment ago is never deleted. Its files are unreachable from then on.
  const gone = await sql`
    DELETE FROM projects WHERE id IN (
      SELECT p.id FROM projects p
      WHERE p.counted_at IS NULL
        -- Projects from before usage was counted can have finished videos without counted_at.
        AND NOT EXISTS (SELECT 1 FROM renders r WHERE r.project_id = p.id AND r.status = 'done')
        AND greatest(
              p.updated_at,
              (SELECT max(c.created_at) FROM clips c WHERE c.project_id = p.id),
              (SELECT i.updated_at FROM inspirations i WHERE i.project_id = p.id),
              (SELECT max(r.updated_at) FROM renders r WHERE r.project_id = p.id)
            ) < now() - make_interval(days => ${DRAFT_DAYS})
      ORDER BY p.updated_at
      LIMIT ${limit}
    )
    RETURNING id, user_id`;
  let files = 0;
  let failed = 0;
  for (const row of gone) {
    try {
      files += await deletePrefix(`u/${row.user_id}/p/${row.id}/`);
    } catch (error) {
      failed++;
      console.error(`Cleanup: deleting files of draft ${row.id} failed:`, error);
    }
  }
  return { projects: gone.length, files, failed };
}
