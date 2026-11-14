import { jsonError, readJson, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { getBusiness, parseBusiness, saveBusiness } from "@/lib/business";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  return Response.json({ business: await getBusiness(userId) });
}

/** Saves the user's business profile. */
export async function PUT(request: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const parsed = parseBusiness(await readJson(request));
  if ("error" in parsed) return jsonError(parsed.error, 400);
  try {
    await saveBusiness(userId, parsed);
  } catch (error) {
    console.error("Saving business profile failed:", error);
    return serverError();
  }
  return Response.json({ business: parsed });
}
