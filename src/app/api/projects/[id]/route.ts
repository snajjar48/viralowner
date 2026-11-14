import { jsonError, readJson, withProject } from "@/lib/api";
import { deleteProjectRecords, PROJECT_NAME_MAX, renameProject } from "@/lib/projects";
import { deletePrefix } from "@/lib/storage";

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

/** Deletes a video project: its versions, clips, inspo and every file. Can't be undone. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return withProject(ctx.params, "Deleting project", async (userId, project) => {
    // The worker would keep writing files into it.
    if (project.status === "processing" || project.status === "analyzing") {
      return jsonError("this video is still being made. delete it once it’s finished.", 409);
    }
    try {
      await deleteProjectRecords(project.id);
    } catch (error) {
      console.error("Deleting project records failed:", error);
      return jsonError("couldn’t delete it right now. please try again later.", 503);
    }
    // The records are gone, so the files can't be reached any more; clean them up after.
    await deletePrefix(`u/${userId}/p/${project.id}/`).catch((error) => console.error("Deleting project files failed:", error));
    return Response.json({ deleted: true });
  });
}
