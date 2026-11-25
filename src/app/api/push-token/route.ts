import { jsonError, readJson, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { isPushToken, removePushToken, savePushToken } from "@/lib/push";

/** { token }: the iPhone app's push token for the signed-in account (POST saves it, DELETE removes it). */
async function handle(request: Request, save: boolean) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const body = await readJson(request);
  if (!isPushToken(body?.token)) return jsonError("invalid token.", 400);
  try {
    if (save) await savePushToken(userId, body.token);
    else await removePushToken(userId, body.token);
  } catch (error) {
    console.error("Saving push token failed:", error);
    return serverError();
  }
  return Response.json({ ok: true });
}

export const POST = (request: Request) => handle(request, true);
export const DELETE = (request: Request) => handle(request, false);
