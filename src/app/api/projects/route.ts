import { jsonError, readJson, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { startInspoUpload } from "@/lib/inspo";
import { canCreateProject } from "@/lib/membership";
import { createProject, createScratchProject } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";
import { DEFAULT_OPTIONS, PROMPT_MAX } from "@/lib/video-options";

/**
 * Starts a new video.
 *   { kind: "scratch", prompt }  "start from scratch" (Pro): returns the new project's id.
 *   otherwise (an inspo's file details): creates the project and returns where to upload the inspo.
 */
export async function POST(request: Request) {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const body = await readJson(request);
    if (!body) return jsonError("invalid request.", 400);
    if (!(await checkRateLimit(`projects:${userId}`, 20))) {
      return jsonError("you’ve started a lot of videos in the last few minutes. please wait a bit and try again.", 429);
    }

    const kind = body.kind === "scratch" ? "scratch" : "inspo";
    const blocked = await canCreateProject(userId, kind);
    if (blocked) return Response.json({ error: blocked.message, reason: blocked.reason }, { status: blocked.status });

    if (kind === "scratch") {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return jsonError("describe the video you want first.", 400);
      if (prompt.length > PROMPT_MAX) return jsonError(`your description can be up to ${PROMPT_MAX} characters.`, 400);
      const project = await createScratchProject(userId, prompt, {
        ...DEFAULT_OPTIONS,
        text: { ...DEFAULT_OPTIONS.text, mode: "adapt" },
      });
      return Response.json({ projectId: project.id });
    }

    const project = await createProject(userId);
    const result = await startInspoUpload(userId, project.id, body);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json({ projectId: project.id, upload: result.upload });
  } catch (error) {
    console.error("Creating project failed:", error);
    return serverError();
  }
}
