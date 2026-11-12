import { jsonError, readJson, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { startInspoUpload } from "@/lib/inspo";
import { canCreateProject } from "@/lib/membership";
import { createProject } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";

/** Step 1: creates a project for a new inspo and returns where to upload it. */
export async function POST(request: Request) {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const body = await readJson(request);
    if (!body) return jsonError("invalid request.", 400);
    if (!(await checkRateLimit(`projects:${userId}`, 20))) {
      return jsonError("you’ve started a lot of videos in the last few minutes. please wait a bit and try again.", 429);
    }

    const blocked = await canCreateProject(userId);
    if (blocked) return Response.json({ error: blocked.message, reason: blocked.reason }, { status: blocked.status });

    const project = await createProject(userId);
    const result = await startInspoUpload(userId, project.id, body);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json({ projectId: project.id, upload: result.upload });
  } catch (error) {
    console.error("Creating project failed:", error);
    return serverError();
  }
}
