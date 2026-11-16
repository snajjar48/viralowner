import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseSecretKey } from "./supabase/env";
import { cleanEmail } from "./testers";

/**
 * A tester's invite link (/join?e=<email>&t=<token>): signed with the server's secret, so it only works
 * for that email, and only while the email is on the testers list (checked wherever it's used). It lets
 * them sign up without a card and past the site password.
 */

function sign(email: string) {
  return createHmac("sha256", `${supabaseSecretKey()}:viralowner-tester-invite-v1`).update(email).digest("hex").slice(0, 32);
}

export function inviteUrl(email: string, origin = "https://www.viralowner.com") {
  const e = cleanEmail(email);
  if (!e) return null;
  return `${origin}/join?e=${encodeURIComponent(e)}&t=${sign(e)}`;
}

/** The invite's email if the token is genuine (whether it's still a tester is checked separately). */
export function inviteEmail(email: unknown, token: unknown): string | null {
  const e = cleanEmail(email);
  if (!e || typeof token !== "string" || token.length !== 32) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(sign(e));
  return a.length === b.length && timingSafeEqual(a, b) ? e : null;
}
