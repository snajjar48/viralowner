import { notFound, withProject } from "@/lib/api";
import { deleteClip } from "@/lib/projects";
import { deleteObject } from "@/lib/storage";

/** Removes a clip and its file. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]/clips/[clipId]">) {
  return withProject(ctx.params, "Deleting clip", async (_userId, project) => {
    const { clipId } = await ctx.params;
    const key = await deleteClip(project.id, clipId);
    if (!key) return notFound();
    await deleteObject(key).catch((e) => console.error("Deleting clip file failed:", e));
    return Response.json({ ok: true });
  });
}
