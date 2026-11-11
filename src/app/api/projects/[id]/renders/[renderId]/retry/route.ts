import { jsonError, notFound, withProject } from "@/lib/api";
import { getActiveRender, getRender } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";
import { retryRender } from "@/lib/renders";

/** "try again" after a failed render: restarts it with the same settings. */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/renders/[renderId]/retry">) {
  return withProject(ctx.params, "Retrying render", async (userId, project) => {
    const { renderId } = await ctx.params;
    const render = await getRender(project.id, renderId);
    if (!render) return notFound();
    if (render.status !== "failed") return jsonError("this version isn’t in a failed state.", 409);
    if (await getActiveRender(project.id)) return jsonError("another version is still being made.", 409);
    if (!(await checkRateLimit(`renders:${userId}`, 20))) {
      return jsonError("too many tries in the last few minutes. please wait a bit and try again.", 429);
    }
    const problem = await retryRender(userId, project, render);
    if (problem) return jsonError(problem.error, problem.status);
    return Response.json({ renderId: render.id });
  });
}
