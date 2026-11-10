import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Password gate for everything except the public waitlist page.
 *
 * The password lives only in the SITE_PASSWORD env var. The access cookie
 * holds an HMAC derived from it, so the password itself is never stored in
 * the browser, and changing SITE_PASSWORD signs everyone out.
 */

export const ACCESS_COOKIE = "vo_access";
export const ACCESS_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sitePassword() {
  return process.env.SITE_PASSWORD || "";
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** Value stored in the access cookie. Null if no password is configured. */
export function accessToken(): string | null {
  const password = sitePassword();
  if (!password) return null;
  return createHmac("sha256", password).update("viralowner-site-access-v1").digest("hex");
}

export function isValidAccessToken(token: string | undefined): boolean {
  const expected = accessToken();
  if (!expected || !token) return false; // fail closed
  return timingSafeEqual(digest(token), digest(expected));
}

export function isCorrectPassword(input: string): boolean {
  const password = sitePassword();
  if (!password) return false; // fail closed
  return timingSafeEqual(digest(input), digest(password));
}
