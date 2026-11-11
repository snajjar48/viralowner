import { notFound, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { completeInspo } from "@/lib/inspo";
import { getProject } from "@/lib/projects";

/**
 * Called when the browser finishes uploading the inspo (and to retry).
 * Verifies the file on the server, then analyzes it into a shot list.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/inspo/complete">) {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { id } = await ctx.params;
    if (!(await getProject(userId, id))) return notFound();

    const result = await completeInspo(userId, id);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Completing inspo failed:", error);
    return serverError();
  }
}
