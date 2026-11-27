import { jsonError, readJson, serverError, unauthorized } from "@/lib/api";
import { isCategory } from "@/lib/categories";
import { onboardingOf } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

/** { category?, done? }: saves the one-time setup's answers (lib/onboarding.ts). category null clears it. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();
  const body = await readJson(request);
  if (!body || typeof body !== "object") return jsonError("invalid request.", 400);
  const next = onboardingOf(user);
  if ("category" in body) {
    if (body.category !== null && !isCategory(body.category)) return jsonError("invalid category.", 400);
    next.category = body.category;
  }
  if (body.done === true) next.done = true;
  const { error } = await supabase.auth.updateUser({ data: { onboarding: next } });
  if (error) {
    console.error("Saving onboarding failed:", error);
    return serverError();
  }
  return Response.json({ ok: true });
}
