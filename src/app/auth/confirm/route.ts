import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>(["signup", "email", "invite", "magiclink", "email_change", "recovery"]);

/**
 * Where the "confirm your email" link lands. Handles both Supabase link styles:
 * ?token_hash=…&type=… (works in any browser) and ?code=… (default template;
 * only works in the browser that signed up).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  const next = safeNextPath(params.get("next"));

  try {
    const supabase = await createClient();
    let ok = false;

    if (tokenHash && type && OTP_TYPES.has(type)) {
      ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
    } else if (code) {
      ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
    }

    if (ok) return NextResponse.redirect(new URL(next, request.url));
  } catch (error) {
    console.error("Email confirmation failed:", error);
  }

  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
