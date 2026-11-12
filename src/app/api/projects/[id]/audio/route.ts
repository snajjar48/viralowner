import { jsonError, readJson, withProject } from "@/lib/api";
import { removeAudio, startAudioUpload } from "@/lib/audio";
import { checkRateLimit } from "@/lib/rate-limit";

/** Adds (or replaces) the project's own audio file: returns where to upload it. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/audio">) {
  return withProject(ctx.params, "Starting audio upload", async (userId, project) => {
    const body = await readJson(request);
    if (!body) return jsonError("invalid request.", 400);
    if (!(await checkRateLimit(`audio:${userId}`, 30))) {
      return jsonError("too many uploads in the last few minutes. please wait a bit and try again.", 429);
    }
    const result = await startAudioUpload(userId, project, body);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json({ upload: result.upload });
  });
}

/** Removes the project's own audio file. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]/audio">) {
  return withProject(ctx.params, "Removing audio", async (_userId, project) => {
    await removeAudio(project);
    return Response.json({ ok: true });
  });
}
