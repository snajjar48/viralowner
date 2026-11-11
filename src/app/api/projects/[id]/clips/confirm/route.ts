import { jsonError, readJson, withProject } from "@/lib/api";
import { confirmClipRights, listClips } from "@/lib/projects";

/** Step 2 → 3: records the rights confirmation (needs at least one uploaded clip). */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/clips/confirm">) {
  return withProject(ctx.params, "Confirming clips", async (userId, project) => {
    const body = await readJson(request);
    if (body?.rightsConfirmed !== true) {
      return jsonError("please confirm you own or have permission to use these clips.", 400);
    }
    const clips = await listClips(userId, project.id);
    if (!clips.some((c) => c.status === "uploaded")) return jsonError("upload at least one clip first.", 400);
    await confirmClipRights(project.id);
    return Response.json({ ok: true });
  });
}
