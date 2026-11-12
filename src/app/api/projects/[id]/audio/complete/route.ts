import { jsonError, withProject } from "@/lib/api";
import { completeAudio } from "@/lib/audio";

/** Called after the browser uploads the audio file. */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/audio/complete">) {
  return withProject(ctx.params, "Finishing audio upload", async (_userId, project) => {
    const result = await completeAudio(project);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json({ audio: result.audio });
  });
}
