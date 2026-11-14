import { jsonError, readJson, withProject } from "@/lib/api";
import { PROJECT_NAME_MAX, renameProject } from "@/lib/projects";

/** { name }: renames a video project ("" goes back to the name we make for it). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return withProject(ctx.params, "Renaming project", async (_userId, project) => {
    const body = await readJson(request);
    if (typeof body?.name !== "string") return jsonError("invalid request.", 400);
    const name = body.name.replace(/\s+/g, " ").trim();
    if (name.length > PROJECT_NAME_MAX) return jsonError(`keep the name under ${PROJECT_NAME_MAX} characters.`, 400);
    try {
      await renameProject(project.id, name);
    } catch (error) {
      // Before the names migration runs, the column isn't there yet.
      console.error("Renaming project failed:", error);
      return jsonError("couldn’t rename it right now. please try again later.", 503);
    }
    return Response.json({ name });
  });
}
