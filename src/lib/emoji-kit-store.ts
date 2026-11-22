import "server-only";
import { hasEmoji, type EmojiKit } from "./emoji-kit";
import type { RenderPlan } from "./processing/types";
import { deleteObject, headObject, listEmojiKitKeys, putObject, readSmallObject } from "./storage";

/** Where a user's emoji kit lives (one per user: the device they last made videos on). */
export const kitFolder = (userId: string) => `u/${userId}/emoji/`;
export const kitIndexKey = (userId: string) => `${kitFolder(userId)}kit.json`;
const pendingKey = (userId: string) => `${kitFolder(userId)}pending.json`;

/** Each sheet's file can be at most this big. */
export const SHEET_MAX_BYTES = 12 * 1024 * 1024;

/** The JSON file: "missing" (not there), "bad" (there but couldn't be read), or its contents. Never throws. */
async function readJsonFile<T>(key: string): Promise<{ state: "missing" } | { state: "bad" } | { state: "ok"; value: T }> {
  try {
    // Read whole (no size check first: storage leaves the size out of compressed replies).
    const bytes = await readSmallObject(key, 400_000);
    if (!bytes) return { state: "missing" };
    return { state: "ok", value: JSON.parse(new TextDecoder().decode(bytes)) as T };
  } catch (error) {
    console.error("Emoji kit file unreadable:", key.split("/").pop(), error instanceof Error ? error.message : error);
    return { state: "bad" };
  }
}

/** The JSON file, or null if it's missing or unreadable (never throws). */
async function readJsonObject<T>(key: string): Promise<T | null> {
  const r = await readJsonFile<T>(key);
  return r.state === "ok" ? r.value : null;
}

const writeJson = (key: string, value: unknown) =>
  putObject(key, new TextEncoder().encode(JSON.stringify(value)), "application/json");

export const readKit = (userId: string) => readJsonObject<EmojiKit>(kitIndexKey(userId));
export const readPending = (userId: string) => readJsonObject<EmojiKit>(pendingKey(userId));
/**
 * Starts a new upload. Nothing is deleted here: the kit in use (and an earlier upload a video may be
 * reading right now) stay until a new kit is finished, so a phone that never finishes its upload can't
 * leave the account without its emoji.
 */
export async function savePending(userId: string, kit: EmojiKit) {
  await writeJson(pendingKey(userId), kit);
}

/** A kit the video worker can read: any version (an older one is still the device's own emoji), as
 * long as its grid is one the worker accepts (worker/app.py install_emoji_kit). */
function usableKit(kit: EmojiKit | null): kit is EmojiKit {
  return (
    !!kit &&
    Number.isInteger(kit.cell) && kit.cell >= 32 && kit.cell <= 512 &&
    Number.isInteger(kit.cols) && kit.cols >= 1 && kit.cols <= 64 &&
    Array.isArray(kit.sheets) && kit.sheets.length > 0
  );
}

/** Makes the uploaded kit the user's kit, once every sheet is really there; removes the old one's files. */
export async function finishKit(userId: string): Promise<boolean> {
  const kit = await readPending(userId);
  if (!usableKit(kit)) {
    const k = kit as Partial<EmojiKit> | null;
    if (k) console.error("Emoji kit finish: pending kit unusable", { v: k.v, cell: k.cell, cols: k.cols });
    return false;
  }
  for (const sheet of kit.sheets) {
    const head = await headObject(sheet.key);
    if (!head || head.sizeBytes <= 0 || head.sizeBytes > SHEET_MAX_BYTES) {
      console.error("Emoji kit finish: sheet missing or too big", { sheet: sheet.key.split("/").pop(), bytes: head?.sizeBytes ?? null });
      return false;
    }
  }
  await writeJson(kitIndexKey(userId), kit);
  // The upload is the kit now. (A newer upload started meanwhile keeps its own pending file.)
  const still = await readPending(userId);
  if (still && still.sheets?.[0]?.key === kit.sheets[0].key) await deleteObject(pendingKey(userId)).catch(() => {});
  await removeLeftovers(userId, kit);
  return true;
}

/** Files younger than this are never cleaned up (an upload may still be on its way, or a video reading them). */
const LEFTOVER_MIN_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Removes old files in the kit folder that no kit points to (earlier kits, abandoned uploads), after a kit
 * is finished. Whatever kit.json and pending.json point to right now is always kept, files from the last
 * few hours are kept, and if either index can't be read nothing is removed.
 */
async function removeLeftovers(userId: string, kit: EmojiKit) {
  try {
    const [current, pending] = await Promise.all([readJsonFile<EmojiKit>(kitIndexKey(userId)), readJsonFile<EmojiKit>(pendingKey(userId))]);
    if (current.state === "bad" || pending.state === "bad") return;
    const keep = new Set([kitIndexKey(userId), pendingKey(userId)]);
    for (const k of [kit, current.state === "ok" ? current.value : null, pending.state === "ok" ? pending.value : null]) {
      for (const sh of k?.sheets ?? []) keep.add(sh.key);
    }
    const now = Date.now();
    const stale = (await listEmojiKitKeys(kitFolder(userId))).filter(
      (o) => !keep.has(o.key) && Number.isFinite(o.modified) && now - o.modified > LEFTOVER_MIN_AGE_MS,
    );
    await Promise.all(stale.map((o) => deleteObject(o.key).catch(() => {})));
  } catch (error) {
    console.error("Emoji kit cleanup failed:", error);
  }
}

/** The user's kit for the video worker: its address, or null if they don't have one. A kit whose
 * sheets all arrived but whose phone never sent "finish" (the page was closed, the app was switched
 * away from, an update landed in between) is finished here, so their videos still get their emoji. */
export async function emojiKitKeyFor(fileKey: string): Promise<string | null> {
  const user = /^u\/([A-Za-z0-9-]+)\//.exec(fileKey)?.[1];
  if (!user) return null;
  try {
    // A newer upload whose sheets are all there wins over the kit in use.
    if ((await headObject(pendingKey(user))) && (await finishKit(user))) {
      console.log("Emoji kit: finished an uploaded kit at render time");
      return kitIndexKey(user);
    }
    return (await headObject(kitIndexKey(user))) ? kitIndexKey(user) : null;
  } catch {
    return null;
  }
}

/**
 * Whether this version could have the maker's own emoji but doesn't: its text or captions have emoji, the
 * account has a kit now, and the version was drawn with another style (Google's, another phone, or made
 * before that was saved). Then a free remake with the same edit fixes it.
 */
export async function emojiRedoOffered(userId: string, plan: RenderPlan | null | undefined): Promise<boolean> {
  if (!plan) return false;
  const words = [...(plan.texts ?? []), ...(plan.textItems ?? []).map((t) => t.text), plan.captionText ?? ""].join(" ");
  if (!hasEmoji(words)) return false;
  const kit = await readKit(userId).catch(() => null);
  return !!kit?.style && plan.emojiStyle !== kit.style;
}
