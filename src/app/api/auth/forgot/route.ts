import { clientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/signup-validation";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

/**
 * Emails a reset-password link. Always answers the same way, so it can't be
 * used to find out which emails have accounts.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return Response.json({ error: "Please enter your email." }, { status: 400 });

  try {
    if (!(await checkRateLimit(`forgot:${clientIp(request)}`, 5))) {
      return Response.json({ error: "Too many attempts. Please try again in a few minutes." }, { status: 429 });
    }
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password`,
    });
    if (error && error.status !== 429) console.error("Password reset email failed:", error.code, error.message);
  } catch (error) {
    console.error("Password reset failed:", error);
  }
  return Response.json({ ok: true });
}
