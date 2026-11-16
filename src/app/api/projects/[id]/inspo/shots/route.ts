import { jsonError, readJson, withProject } from "@/lib/api";
import { isOneTake } from "@/lib/processing/types";
import { getInspiration, listRenders, saveReshapedBreakdown } from "@/lib/projects";
import { reshape, shotCountRange } from "@/lib/shot-count";

/** { count }: how many shots the video has (fewer or more than the inspo). Before the first version. */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]/inspo/shots">) {
  return withProject(ctx.params, "Changing shot count", async (userId, project) => {
    const body = await readJson(request);
    const count = typeof body?.count === "number" && Number.isInteger(body.count) ? body.count : null;
    const inspo = await getInspiration(userId, project.id);
    if (!inspo?.breakdown || inspo.status !== "ready") return jsonError("your inspo isn’t ready yet.", 409);
    if (isOneTake(inspo.breakdown)) return jsonError("this inspo is one take: it’s cut to match what you say.", 409);
    const { min, max } = shotCountRange(inspo.breakdown);
    if (count === null || count < min || count > max) return jsonError(`pick between ${min} and ${max} shots.`, 400);
    if ((await listRenders(userId, project.id)).length) {
      return jsonError("this video has versions already. start a new project to change the number of shots.", 409);
    }
    const next = reshape(inspo.breakdown, count);
    await saveReshapedBreakdown(project.id, next);
    return Response.json({ shotCount: next.shotCount });
  });
}
