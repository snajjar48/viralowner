import { jsonError, readJson } from "@/lib/api";
import { ADMIN_COOKIE, adminAccount, adminSessionValue, isAdminPassword } from "@/lib/admin-auth";
import { checkRateLimit } from "@/lib/rate-limit";

/** { password }: opens the admin dashboard for the signed-in owner (12 hours). */
export async function POST(request: Request) {
  const account = await adminAccount();
  if (!account) return jsonError("not found.", 404);
  // A short password: few tries allowed.
  if (!(await checkRateLimit(`admin-login:${account.id}`, 5))) {
    return jsonError("too many tries. wait 10 minutes and try again.", 429);
  }
  const body = await readJson(request);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !isAdminPassword(password)) return jsonError("that password isn’t right.", 401);
  const { value, maxAge } = adminSessionValue(account.id);
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`,
  );
  return res;
}
