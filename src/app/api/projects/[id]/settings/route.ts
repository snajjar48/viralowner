import { jsonError, readJson, withProject } from "@/lib/api";
import { saveSettings } from "@/lib/projects";
import { parseVideoOptions } from "@/lib/video-options";

/** Saves the step 3 options (validated; unknown values fall back to defaults). */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]/settings">) {
  return withProject(ctx.params, "Saving options", async (_userId, project) => {
    const options = parseVideoOptions(await readJson(request));
    if ("error" in options) return jsonError(options.error, 400);
    await saveSettings(project.id, options);
    return Response.json({ options });
  });
}
