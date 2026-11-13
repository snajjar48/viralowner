import { jsonError, readJson, withProject } from "@/lib/api";
import { saveProjectPrompt } from "@/lib/projects";
import { PROMPT_MAX } from "@/lib/video-options";

/** Saves a "start from scratch" video's prompt (what the user wants the video to be). */
export async function PUT(request: Request, ctx: RouteContext<"/api/projects/[id]/prompt">) {
  return withProject(ctx.params, "Saving prompt", async (_userId, project) => {
    if (project.kind !== "scratch") return jsonError("this video doesn’t use a prompt.", 400);
    const body = await readJson(request);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return jsonError("describe the video you want first.", 400);
    if (prompt.length > PROMPT_MAX) return jsonError(`your description can be up to ${PROMPT_MAX} characters.`, 400);
    await saveProjectPrompt(project.id, prompt);
    return Response.json({ prompt });
  });
}
