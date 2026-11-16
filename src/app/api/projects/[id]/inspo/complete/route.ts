import { notFound, readJson, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { completeInspo } from "@/lib/inspo";
import { isCategory } from "@/lib/categories";
import { getProject, setProjectCategory } from "@/lib/projects";

/**
 * Called when the browser finishes uploading the inspo (and to retry).
 * Verifies the file on the server, then analyzes it into a shot list.
 * { uploadId?, category, styleReferenceConfirmed }: starting the analysis needs the confirmation.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/inspo/complete">) {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { id } = await ctx.params;
    if (!(await getProject(userId, id))) return notFound();

    const body = await readJson(request);
    const uploadId = typeof body?.uploadId === "string" && body.uploadId.length < 1024 ? body.uploadId : undefined;
    if (isCategory(body?.category)) await setProjectCategory(id, body.category);
    const result = await completeInspo(userId, id, uploadId, body?.styleReferenceConfirmed === true);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Completing inspo failed:", error);
    return serverError();
  }
}
