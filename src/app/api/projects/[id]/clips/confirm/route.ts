import { jsonError, readJson, withProject } from "@/lib/api";
import { confirmClipRights } from "@/lib/projects";

/**
 * Step 2 → 3: records the rights confirmation. Clips may still be uploading (they keep going on the
 * next step, which waits for them before making the video; making one needs an uploaded clip).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/clips/confirm">) {
  return withProject(ctx.params, "Confirming clips", async (_userId, project) => {
    const body = await readJson(request);
    if (body?.rightsConfirmed !== true) {
      return jsonError("please confirm you own or have permission to use these clips.", 400);
    }
    await confirmClipRights(project.id);
    return Response.json({ ok: true });
  });
}
