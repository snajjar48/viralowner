import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/signup-validation";
import { createClient } from "@/lib/supabase/server";

/** Sets a new password for the signed-in user (after following the reset link). */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < PASSWORD_MIN) {
    return Response.json({ error: `Password must be at least ${PASSWORD_MIN} characters.` }, { status: 400 });
  }
  if (password.length > PASSWORD_MAX) {
    return Response.json({ error: `Password must be at most ${PASSWORD_MAX} characters.` }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Your reset link expired. Please ask for a new one." }, { status: 401 });
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.code === "weak_password") {
        return Response.json({ error: "That password is too weak. Try a longer one." }, { status: 400 });
      }
      if (error.code === "same_password") {
        return Response.json({ error: "That’s your current password. Pick a new one." }, { status: 400 });
      }
      console.error("Updating password failed:", error);
      return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Updating password failed:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
