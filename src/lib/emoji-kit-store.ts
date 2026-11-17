import "server-only";
import type { EmojiKit } from "./emoji-kit";
import { deleteObject, headObject, listEmojiKitKeys, putObject, readRange } from "./storage";

/** Where a user's emoji kit lives (one per user: the device they last made videos on). */
export const kitFolder = (userId: string) => `u/${userId}/emoji/`;
export const kitIndexKey = (userId: string) => `${kitFolder(userId)}kit.json`;
const pendingKey = (userId: string) => `${kitFolder(userId)}pending.json`;

/** Each sheet's file can be at most this big. */
export const SHEET_MAX_BYTES = 12 * 1024 * 1024;

async function readJsonObject<T>(key: string): Promise<T | null> {
  const head = await headObject(key);
  if (!head || head.sizeBytes > 400_000) return null;
  const bytes = await readRange(key, 0, head.sizeBytes - 1);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

const writeJson = (key: string, value: unknown) =>
  putObject(key, new TextEncoder().encode(JSON.stringify(value)), "application/json");

export const readKit = (userId: string) => readJsonObject<EmojiKit>(kitIndexKey(userId));
export const readPending = (userId: string) => readJsonObject<EmojiKit>(pendingKey(userId));
/** Starts a new upload; files of earlier unfinished uploads are removed. */
export async function savePending(userId: string, kit: EmojiKit) {
  await removeLeftovers(userId, await readKit(userId).catch(() => null));
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
  await deleteObject(pendingKey(userId)).catch(() => {});
  await removeLeftovers(userId, kit);
  return true;
}

/** Removes every file in the kit folder that isn't part of `kit` (earlier kits, unfinished uploads). */
async function removeLeftovers(userId: string, kit: EmojiKit | null) {
  try {
    const keep = new Set([kitIndexKey(userId), pendingKey(userId), ...(kit?.sheets ?? []).map((s) => s.key)]);
    const stale = (await listEmojiKitKeys(kitFolder(userId))).filter((k) => !keep.has(k));
    await Promise.all(stale.map((k) => deleteObject(k).catch(() => {})));
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
