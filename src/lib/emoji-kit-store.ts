import "server-only";
import { EMOJI_KIT_CELL, EMOJI_KIT_COLS, EMOJI_KIT_VERSION, type EmojiKit } from "./emoji-kit";
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

/** Makes the uploaded kit the user's kit, once every sheet is really there; removes the old one's files. */
export async function finishKit(userId: string): Promise<boolean> {
  const kit = await readPending(userId);
  if (!kit || kit.v !== EMOJI_KIT_VERSION || kit.cell !== EMOJI_KIT_CELL || kit.cols !== EMOJI_KIT_COLS) {
    console.error("Emoji kit finish: no current pending kit", { v: kit?.v, cell: kit?.cell });
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

/** The user's kit for the video worker: its address, or null if they don't have a finished one. */
export async function emojiKitKeyFor(fileKey: string): Promise<string | null> {
  const user = /^u\/([A-Za-z0-9-]+)\//.exec(fileKey)?.[1];
  if (!user) return null;
  try {
    return (await headObject(kitIndexKey(user))) ? kitIndexKey(user) : null;
  } catch {
    return null;
  }
}
