import { readJson, withProject } from "@/lib/api";
import { completeClip } from "@/lib/clips";

/**
 * Called when the browser finishes uploading a clip; verifies it on the server.
 * `{ uploadId }` when it was uploaded in parts.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/clips/[clipId]/complete">) {
  return withProject(ctx.params, "Completing clip", async (_userId, project) => {
    const { clipId } = await ctx.params;
    const body = await readJson(request);
    const uploadId = typeof body?.uploadId === "string" && body.uploadId.length < 1024 ? body.uploadId : undefined;
    // hasThumb: false when the browser couldn't make the clip's still (the worker makes it instead).
    const result = await completeClip(project.id, clipId, uploadId, body?.hasThumb !== false);
    return Response.json(result.body, { status: result.status });
  });
}
