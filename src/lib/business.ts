import "server-only";
import { getSql } from "./db";

/** What a user tells us about themselves and their business, asked once and used on every video. */
export interface BusinessProfile {
  name: string;
  /** What they sell or do. */
  about: string;
  city: string;
  /** Names, products and words to always spell their way ("boba, croffle, Blendz"). */
  words: string;
  /** Their role ("owner", "social media manager"). */
  role: string;
  /** What they use the site for ("promote my shop", "videos for my clients"). */
  purpose: string;
  /** Anything else to remember when we make their videos. */
  notes: string;
}

export const BUSINESS_LIMITS = {
  name: 80,
  about: 300,
  city: 80,
  words: 300,
  role: 80,
  purpose: 200,
  notes: 1000,
} as const;
export const EMPTY_BUSINESS: BusinessProfile = { name: "", about: "", city: "", words: "", role: "", purpose: "", notes: "" };

export function hasBusiness(p: BusinessProfile | null) {
  return !!p && Object.values(p).some(Boolean);
}

function fromRow(r: Record<string, unknown> | undefined): BusinessProfile | null {
  if (!r) return null;
  const out = { ...EMPTY_BUSINESS };
  for (const key of Object.keys(EMPTY_BUSINESS) as (keyof BusinessProfile)[]) {
    out[key] = typeof r[key] === "string" ? (r[key] as string) : "";
  }
  return out;
}

/** The user's profile, or null. Never throws (videos are made without it if it can't be read). */
export async function getBusiness(userId: string): Promise<BusinessProfile | null> {
  try {
    const rows = await getSql()`SELECT * FROM business_profiles WHERE user_id = ${userId}`;
    return fromRow(rows[0]);
  } catch (error) {
    console.error("Reading business profile failed:", error);
    return null;
  }
}

export async function getBusinessForProject(projectId: string): Promise<BusinessProfile | null> {
  try {
    const rows = await getSql()`
      SELECT b.* FROM business_profiles b JOIN projects p ON p.user_id = b.user_id WHERE p.id = ${projectId}`;
    return fromRow(rows[0]);
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
    // Notes keep their line breaks; everything else is one line.
    const text =
      typeof v !== "string"
        ? ""
        : key === "notes"
          ? v.replace(/\r/g, "").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
          : v.replace(/\s+/g, " ").trim();
    if (text.length > BUSINESS_LIMITS[key]) return { error: `that's a bit long. keep it under ${BUSINESS_LIMITS[key]} characters.` };
    out[key] = text;
  }
  return out;
}

export async function saveBusiness(userId: string, p: BusinessProfile) {
  await getSql()`
    INSERT INTO business_profiles (user_id, name, about, city, words, role, purpose, notes, updated_at)
    VALUES (${userId}, ${p.name}, ${p.about}, ${p.city}, ${p.words}, ${p.role}, ${p.purpose}, ${p.notes}, now())
    ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, about = EXCLUDED.about, city = EXCLUDED.city,
      words = EXCLUDED.words, role = EXCLUDED.role, purpose = EXCLUDED.purpose, notes = EXCLUDED.notes,
      updated_at = now()`;
}

/**
 * The profile, as a few lines for the editor. "" if there's nothing. The spelling comes first:
 * the speech recognizer only reads the start.
 */
export function businessText(p: BusinessProfile | null): string {
  if (!p || !hasBusiness(p)) return "";
  return [
    p.name && `business: ${p.name}`,
    p.words && `always spell these exactly like this: ${p.words}`,
    p.about && `what they sell or do: ${p.about}`,
    p.city && `where: ${p.city}`,
    p.role && `the user's role: ${p.role}`,
    p.purpose && `what they make videos for: ${p.purpose}`,
    p.notes && `what they asked us to remember for every video:\n${p.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}
