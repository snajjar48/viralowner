import "server-only";
import { getUserId } from "./auth";
import { getProject, type Project } from "./projects";

/** Parses a JSON object body; anything else → null. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export const jsonError = (error: string, status: number) => Response.json({ error }, { status });
export const unauthorized = () => jsonError("please log in again.", 401);
export const notFound = () => jsonError("we couldn’t find that video project.", 404);
export const serverError = () => jsonError("something went wrong on our side. please try again.", 500);

/**
 * Wraps a /api/projects/[id]/… handler: requires a signed-in user who owns
 * the project, and turns unexpected errors into a friendly 500.
 */
export async function withProject(
  params: Promise<{ id: string }>,
  label: string,
  handler: (userId: string, project: Project) => Promise<Response>,
): Promise<Response> {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { id } = await params;
    const project = await getProject(userId, id);
    if (!project) return notFound();
    return await handler(userId, project);
  } catch (error) {
    console.error(`${label} failed:`, error);
    return serverError();
  }
}
