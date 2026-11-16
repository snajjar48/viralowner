import { jsonError, readJson } from "@/lib/api";
import { adminSession } from "@/lib/admin-auth";
import { inviteUrl } from "@/lib/tester-invite";
import { addTester, cleanEmail, removeTester, TESTER_NOTE_MAX } from "@/lib/testers";

/** { email, note? }: gives this email free full access (admin only). */
export async function POST(request: Request) {
  if (!(await adminSession())) return jsonError("not found.", 404);
  const body = await readJson(request);
  const email = cleanEmail(body?.email);
  if (!email) return jsonError("enter a valid email.", 400);
  const note = typeof body?.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, TESTER_NOTE_MAX) : "";
  try {
    await addTester(email, note);
  } catch (error) {
    console.error("Adding tester failed:", error);
    return jsonError("couldn’t save that. run npm run db:migrate first, then try again.", 503);
  }
  return Response.json({ ok: true, email, invite: inviteUrl(email, new URL(request.url).origin) });
}

/** { email }: takes the free access away (admin only). */
export async function DELETE(request: Request) {
  if (!(await adminSession())) return jsonError("not found.", 404);
  const body = await readJson(request);
  const email = cleanEmail(body?.email);
  if (!email) return jsonError("invalid request.", 400);
  await removeTester(email);
  return Response.json({ ok: true });
}
