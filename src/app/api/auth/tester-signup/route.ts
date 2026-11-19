import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { checkRateLimit, SIGNUPS_PER_NETWORK } from "@/lib/rate-limit";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/signup-validation";
import { ACCESS_COOKIE, ACCESS_MAX_AGE, accessToken } from "@/lib/site-access";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { inviteEmail } from "@/lib/tester-invite";
import { isTester } from "@/lib/testers";

const GENERIC_ERROR = "Something went wrong. Please try again.";
const name = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 50) : "");

/**
 * Sign-up from a tester's invite link: no card, no billing details. Only for an email on the testers
 * list with a genuine invite token. Also lets them past the site password (the invite is the owner's say-so).
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    if (!(await checkRateLimit(`signup:${clientIp(request)}`, SIGNUPS_PER_NETWORK))) {
      return Response.json({ error: "Too many attempts. Please try again in a few minutes." }, { status: 429 });
    }
  } catch (error) {
    console.error("Tester signup rate limit failed:", error);
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  const email = inviteEmail(body.email, body.token);
  if (!email || !(await isTester(email))) {
    return Response.json({ error: "This invite link isn’t valid anymore. Ask for a new one." }, { status: 403 });
  }
  const firstName = name(body.firstName);
  const lastName = name(body.lastName);
  const password = typeof body.password === "string" ? body.password : "";
  if (!firstName) return Response.json({ error: "Please enter your first name." }, { status: 400 });
  if (!lastName) return Response.json({ error: "Please enter your last name." }, { status: 400 });
  if (password.length < PASSWORD_MIN) {
    return Response.json({ error: `Password must be at least ${PASSWORD_MIN} characters.` }, { status: 400 });
  }
  if (password.length > PASSWORD_MAX) {
    return Response.json({ error: `Password must be at most ${PASSWORD_MAX} characters.` }, { status: 400 });
  }
  if (password !== body.confirmPassword) return Response.json({ error: "Passwords don’t match." }, { status: 400 });
  if (body.acceptTerms !== true) return Response.json({ error: "Please accept the terms and conditions." }, { status: 400 });

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${request.nextUrl.origin}/auth/confirm`,
        data: { first_name: firstName, last_name: lastName },
      },
    });
    const exists = { error: "You already have an account with this email. Log in instead." };
    if (error) {
      if (error.code === "user_already_exists" || error.code === "email_exists") return Response.json(exists, { status: 409 });
      if (error.code === "weak_password") {
        return Response.json({ error: "That password is too weak. Try a longer one." }, { status: 400 });
      }
      console.error("Tester signUp failed:", error);
      return Response.json({ error: GENERIC_ERROR }, { status: 500 });
    }
    const user = data.user;
    if (!user || user.identities?.length === 0) return Response.json(exists, { status: 409 });

    const { error: profileError } = await createAdminClient().from("profiles").upsert({
      id: user.id,
      first_name: firstName,
      last_name: lastName,
      email,
      phone: "",
      billing_address: {},
      terms_accepted_at: new Date().toISOString(),
    });
    if (profileError) throw profileError;

    const token = accessToken();
    if (token) {
      (await cookies()).set(ACCESS_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: ACCESS_MAX_AGE,
      });
    }
    return Response.json({ ok: true, needsEmailConfirmation: !data.session });
  } catch (error) {
    console.error("Tester signup failed:", error);
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
