import "server-only";
import { getSql } from "./db";

/** A user's business, asked once and used on every video. */
export interface BusinessProfile {
  name: string;
  /** What they sell or do. */
  about: string;
  city: string;
  /** Names, products and words to always spell their way ("boba, croffle, Blendz"). */
  words: string;
}

export const BUSINESS_LIMITS = { name: 80, about: 300, city: 80, words: 300 } as const;
export const EMPTY_BUSINESS: BusinessProfile = { name: "", about: "", city: "", words: "" };

export function hasBusiness(p: BusinessProfile | null) {
  return !!p && !!(p.name || p.about || p.words);
}

/** The user's business, or null. Never throws (videos are made without it if it can't be read). */
export async function getBusiness(userId: string): Promise<BusinessProfile | null> {
  try {
    const rows = await getSql()`SELECT name, about, city, words FROM business_profiles WHERE user_id = ${userId}`;
    const r = rows[0];
    return r ? { name: r.name, about: r.about, city: r.city, words: r.words } : null;
  } catch (error) {
    console.error("Reading business profile failed:", error);
    return null;
  }
}

export async function getBusinessForProject(projectId: string): Promise<BusinessProfile | null> {
  try {
    const rows = await getSql()`
      SELECT b.name, b.about, b.city, b.words FROM business_profiles b
      JOIN projects p ON p.user_id = b.user_id WHERE p.id = ${projectId}`;
    const r = rows[0];
    return r ? { name: r.name, about: r.about, city: r.city, words: r.words } : null;
  } catch (error) {
    console.error("Reading business profile failed:", error);
    return null;
  }
}

export function parseBusiness(body: Record<string, unknown> | null): BusinessProfile | { error: string } {
  if (!body) return { error: "invalid request." };
  const out = { ...EMPTY_BUSINESS };
  for (const key of Object.keys(BUSINESS_LIMITS) as (keyof BusinessProfile)[]) {
    const v = body[key];
    const text = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    if (text.length > BUSINESS_LIMITS[key]) return { error: `that's a bit long. keep it under ${BUSINESS_LIMITS[key]} characters.` };
    out[key] = text;
  }
  return out;
}

export async function saveBusiness(userId: string, p: BusinessProfile) {
  await getSql()`
    INSERT INTO business_profiles (user_id, name, about, city, words, updated_at)
    VALUES (${userId}, ${p.name}, ${p.about}, ${p.city}, ${p.words}, now())
    ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, about = EXCLUDED.about, city = EXCLUDED.city,
      words = EXCLUDED.words, updated_at = now()`;
}

/** The business, as a few lines for the editor. "" if there's nothing. */
export function businessText(p: BusinessProfile | null): string {
  if (!hasBusiness(p)) return "";
  return [
    p!.name && `business: ${p!.name}`,
    p!.about && `what they sell or do: ${p!.about}`,
    p!.city && `where: ${p!.city}`,
    p!.words && `always spell these exactly like this: ${p!.words}`,
  ]
    .filter(Boolean)
    .join("\n");
}
