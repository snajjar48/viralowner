import { jsonError, notFound, readJson, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { startInspoUpload } from "@/lib/inspo";
import { getProject } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";

/** Replaces a project's inspo: returns where to upload the new file. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/inspo">) {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { id } = await ctx.params;
    if (!(await getProject(userId, id))) return notFound();
    const body = await readJson(request);
    if (!body) return jsonError("invalid request.", 400);
    if (!(await checkRateLimit(`inspo:${userId}`, 30))) {
      return jsonError("too many uploads in the last few minutes. please wait a bit and try again.", 429);
    }

    const result = await startInspoUpload(userId, id, body);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json({ upload: result.upload });
  } catch (error) {
    console.error("Starting inspo upload failed:", error);
    return serverError();
  }
}
