import { jsonError, readJson, withProject } from "@/lib/api";
import { getSql } from "@/lib/db";
import { listRenders } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";

const RATINGS = new Set(["loved", "okay", "not_quite"]);

/** { version, rating?, message }: feedback on a finished video, to improve viralowner. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/feedback">) {
  return withProject(ctx.params, "Saving feedback", async (userId, project) => {
    if (!(await checkRateLimit(`feedback:${userId}`, 10))) {
      return jsonError("thanks! that’s a lot of feedback at once. please wait a few minutes.", 429);
    }
    const body = await readJson(request);
    const message = typeof body?.message === "string" ? body.message.trim().slice(0, 3000) : "";
    const rating = typeof body?.rating === "string" && RATINGS.has(body.rating) ? body.rating : null;
    if (!message && !rating) return jsonError("write a note or pick how it turned out.", 400);
    const render = (await listRenders(userId, project.id)).find((r) => r.version === body?.version && r.status === "done");
    if (!render) return jsonError("we couldn’t find that version.", 404);
    try {
      await getSql()`
        INSERT INTO feedback (user_id, project_id, render_id, version, rating, message)
        VALUES (${userId}, ${project.id}, ${render.id}, ${render.version}, ${rating}, ${message})`;
    } catch (error) {
      // Before the feedback migration runs.
      console.error("Saving feedback failed:", error);
      return jsonError("couldn’t send it right now. please try again later.", 503);
    }
    return Response.json({ ok: true });
  });
}
