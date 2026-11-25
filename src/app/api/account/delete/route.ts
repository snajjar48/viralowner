import { jsonError, readJson, serverError, unauthorized } from "@/lib/api";
import { deleteAccount } from "@/lib/account-deletion";
import { getUserId } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/** { confirm: "delete" }: deletes the signed-in account and everything in it, then signs out. */
export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const body = await readJson(request);
  if (String(body?.confirm ?? "").trim().toLowerCase() !== "delete") return jsonError("type delete to confirm.", 400);
  if (!(await checkRateLimit(`delete-account:${userId}`, 3))) return jsonError("please wait a minute and try again.", 429);
  try {
    await deleteAccount(userId);
  } catch (error) {
    console.error("Deleting account failed:", error);
    return serverError();
  }
  try {
    await (await createClient()).auth.signOut();
  } catch {
    // The login is already gone.
  }
  return Response.json({ ok: true });
}
