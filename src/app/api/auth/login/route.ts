import { clientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/signup-validation";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidEmail(email) || !password) {
    return Response.json({ error: "Please enter your email and password." }, { status: 400 });
  }

  try {
    if (!(await checkRateLimit(`login:${clientIp(request)}`))) {
      return Response.json(
        { error: "Too many attempts. Please try again in a few minutes." },
        { status: 429 },
      );
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      if (error.code === "email_not_confirmed") {
        return Response.json(
          { error: "Please confirm your email first. Check your inbox for the link." },
          { status: 403 },
        );
      }
      if (error.code === "invalid_credentials") {
        return Response.json({ error: "Incorrect email or password." }, { status: 401 });
      }
      console.error("Supabase login failed:", error);
      return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Login failed:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
