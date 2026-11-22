import "server-only";
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { supabaseSecretKey } from "./supabase/env";

/**
 * The admin dashboard is only for the owner: it needs BOTH a signed-in owner account (ADMIN_EMAILS,
 * or UNLIMITED_EMAILS if that isn't set) AND the admin password. The password is ADMIN_PASSWORD if
 * set, otherwise the default below (stored as a salted scrypt hash, never in plain text). A correct
 * password gives a signed, httpOnly cookie for 12 hours, tied to that account.
 */

export const ADMIN_COOKIE = "vo_admin";
const SESSION_S = 12 * 60 * 60;
const DEFAULT_PASSWORD_HASH = "075803cf7be5583c3ff821f0c5480b5f:11a50023d027845041c433c1e1175a073dc71657f295e52557e7c2c18af79a53";

export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || process.env.UNLIMITED_EMAILS || "";
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined) {
  return !!email && adminEmails().includes(email.trim().toLowerCase());
}

const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export function isAdminPassword(input: string): boolean {
  const own = process.env.ADMIN_PASSWORD;
  if (own) return same(Buffer.from(input), Buffer.from(own));
  const [salt, hash] = DEFAULT_PASSWORD_HASH.split(":");
  return same(scryptSync(input, salt, 32), Buffer.from(hash, "hex"));
}

/** Changing the password (or the server secret) signs every admin session out. */
function sign(value: string) {
  const key = `${supabaseSecretKey()}:${process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD_HASH}:viralowner-admin-v1`;
  return createHmac("sha256", key).update(value).digest("hex");
}

export function adminSessionValue(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_S;
  const body = `${userId}.${exp}`;
  return { value: `${body}.${sign(body)}`, maxAge: SESSION_S };
}

function validSession(value: string | undefined, userId: string) {
  if (!value) return false;
  const [uid, exp, sig] = value.split(".");
  if (uid !== userId || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return same(Buffer.from(sig), Buffer.from(sign(`${uid}.${exp}`)));
}

/** The signed-in owner account, or null. */
export async function adminAccount(): Promise<{ id: string; email: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) return null;
  return { id: user.id, email: user.email };
}

/** For admin pages and API routes: the owner with a valid admin session, or null. */
export async function adminSession(): Promise<{ id: string; email: string } | null> {
  const account = await adminAccount();
  if (!account) return null;
  const jar = await cookies();
  return validSession(jar.get(ADMIN_COOKIE)?.value, account.id) ? account : null;
}

/** For admin pages: sends anyone else to the admin sign-in (which itself 404s for non-owners). */
export async function requireAdmin() {
  const admin = await adminSession();
  if (!admin) redirect("/admin/login");
  return admin;
}
