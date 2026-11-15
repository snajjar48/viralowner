import { jsonError, readJson } from "@/lib/api";
import { adminSession } from "@/lib/admin-auth";
import { deleteWaitlistEntry } from "@/lib/admin-data";

/** { id }: removes someone from the waitlist (admin only). */
export async function DELETE(request: Request) {
  if (!(await adminSession())) return jsonError("not found.", 404);
  const body = await readJson(request);
  const id = typeof body?.id === "string" && /^\d{1,18}$/.test(body.id) ? body.id : null;
  if (!id) return jsonError("invalid request.", 400);
  await deleteWaitlistEntry(id);
  return Response.json({ ok: true });
}
