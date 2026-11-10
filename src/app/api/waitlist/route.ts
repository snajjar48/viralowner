import { getSql } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

// Pragmatic email check: something@something.tld, no spaces, sane length.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const { email, website } = (body ?? {}) as {
    email?: unknown;
    website?: unknown;
  };

  // Honeypot: real users never see or fill this field. Pretend it worked
  // so bots get no signal.
  if (typeof website === "string" && website.trim() !== "") {
    return json({ ok: true });
  }

  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalized || normalized.length > 254 || !EMAIL_RE.test(normalized)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  try {
    if (!(await checkRateLimit(clientIp(request)))) {
      return json(
        { error: "Too many attempts. Please try again in a few minutes." },
        429,
      );
    }

    const sql = getSql();
    // Duplicate emails are silently ignored by the unique index. The response
    // is identical so the form can't be used to check who has signed up.
    await sql`
      INSERT INTO waitlist_signups (email)
      VALUES (${normalized})
      ON CONFLICT (lower(email)) DO NOTHING
    `;

    return json({ ok: true });
  } catch (error) {
    console.error("Waitlist signup failed:", error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
