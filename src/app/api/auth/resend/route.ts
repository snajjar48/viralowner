import { clientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/signup-validation";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

/** Sends the "confirm your email" link again. Same answer either way. */
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
    if (!(await checkRateLimit(`resend:${clientIp(request)}`, 5))) {
      return Response.json({ error: "Too many attempts. Please try again in a few minutes." }, { status: 429 });
    }
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
    });
    if (error && error.status !== 429) console.error("Resending confirmation failed:", error.code, error.message);
  } catch (error) {
    console.error("Resending confirmation failed:", error);
  }
  return Response.json({ ok: true });
}
