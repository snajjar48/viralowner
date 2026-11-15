import "server-only";
import { EMOJI_KIT_CELL, EMOJI_KIT_COLS, EMOJI_KIT_VERSION, type EmojiKit } from "./emoji-kit";
import { deleteObject, headObject, putObject, readRange } from "./storage";

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
/** Starts a new upload; the files of an earlier one that never finished are removed. */
export async function savePending(userId: string, kit: EmojiKit) {
  const earlier = await readPending(userId).catch(() => null);
  const current = new Set(((await readKit(userId).catch(() => null))?.sheets ?? []).map((s) => s.key));
  await Promise.all(
    (earlier?.sheets ?? [])
      .filter((s) => s.key.startsWith(kitFolder(userId)) && !current.has(s.key))
      .map((s) => deleteObject(s.key).catch(() => {})),
  );
  await writeJson(pendingKey(userId), kit);
}

/** Makes the uploaded kit the user's kit, once every sheet is really there; removes the old one's files. */
export async function finishKit(userId: string): Promise<boolean> {
  const kit = await readPending(userId);
  if (!kit || kit.v !== EMOJI_KIT_VERSION || kit.cell !== EMOJI_KIT_CELL || kit.cols !== EMOJI_KIT_COLS) return false;
  for (const sheet of kit.sheets) {
    const head = await headObject(sheet.key);
    if (!head || head.sizeBytes <= 0 || head.sizeBytes > SHEET_MAX_BYTES) return false;
  }
  const old = await readKit(userId);
  await writeJson(kitIndexKey(userId), kit);
  await deleteObject(pendingKey(userId)).catch(() => {});
  const keep = new Set(kit.sheets.map((s) => s.key));
  await Promise.all((old?.sheets ?? []).filter((s) => !keep.has(s.key)).map((s) => deleteObject(s.key).catch(() => {})));
  return true;
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
