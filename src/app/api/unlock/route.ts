import { cookies } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  accessToken,
  isCorrectPassword,
} from "@/lib/site-access";

export async function POST(request: Request) {
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    if (!(await checkRateLimit(`unlock:${clientIp(request)}`))) {
      return Response.json(
        { error: "Too many attempts. Please try again in a few minutes." },
        { status: 429 },
      );
    }
  } catch (error) {
    console.error("Unlock rate limit failed:", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const token = accessToken();
  if (typeof password !== "string" || !token || !isCorrectPassword(password)) {
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }

  (await cookies()).set(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });
  return Response.json({ ok: true });
}

/** Sign out: clear the access cookie. */
export async function DELETE() {
  (await cookies()).delete(ACCESS_COOKIE);
  return Response.json({ ok: true });
}
