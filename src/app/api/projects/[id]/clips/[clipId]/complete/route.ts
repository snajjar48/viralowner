import { withProject } from "@/lib/api";
import { completeClip } from "@/lib/clips";

/** Called when the browser finishes uploading a clip; verifies it on the server. */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/clips/[clipId]/complete">) {
  return withProject(ctx.params, "Completing clip", async (_userId, project) => {
    const { clipId } = await ctx.params;
    const result = await completeClip(project.id, clipId);
    return Response.json(result.body, { status: result.status });
  });
}
