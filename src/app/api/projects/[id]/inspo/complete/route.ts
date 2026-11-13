import { notFound, readJson, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { completeInspo } from "@/lib/inspo";
import { getProject } from "@/lib/projects";

/**
 * Called when the browser finishes uploading the inspo (and to retry).
 * Verifies the file on the server, then analyzes it into a shot list.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/inspo/complete">) {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { id } = await ctx.params;
    if (!(await getProject(userId, id))) return notFound();

    const body = await readJson(request);
    const uploadId = typeof body?.uploadId === "string" && body.uploadId.length < 1024 ? body.uploadId : undefined;
    const result = await completeInspo(userId, id, uploadId);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Completing inspo failed:", error);
    return serverError();
  }
}
