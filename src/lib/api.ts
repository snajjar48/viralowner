import "server-only";

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
