import { randomUUID } from "node:crypto";
import { jsonError, readJson, serverError, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import {
  EMOJI_KIT_CELL,
  EMOJI_KIT_COLS,
  EMOJI_KIT_PER_SHEET,
  EMOJI_KIT_VERSION,
  isKitEmoji,
  type EmojiKit,
} from "@/lib/emoji-kit";
import { finishKit, kitFolder, readKit, readPending, savePending } from "@/lib/emoji-kit-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { createUploadUrl } from "@/lib/storage";

const TYPES: Record<string, string> = { "image/png": "png", "image/webp": "webp" };

/** Which device's emoji this account's videos use now: { style, v } or { style: null }. */
export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const [kit, pending] = await Promise.all([readKit(userId), readPending(userId)]);
    return Response.json(
      { style: kit?.style ?? null, v: kit?.v ?? null, pending: pending?.v === EMOJI_KIT_VERSION ? pending.style : null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Reading emoji kit failed:", error);
    return serverError();
  }
}

/**
 * { action: "start", style, type, sheets: [[emoji…]…] }: where to upload this device's emoji sheets.
 * { action: "finish" }: once they're uploaded, the account's videos use them.
 */
export async function POST(request: Request) {
  try {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    if (!(await checkRateLimit(`emoji-kit:${userId}`, 6))) return jsonError("try again in a few minutes.", 429);
    const body = await readJson(request);
    if (body?.action === "finish") {
      return (await finishKit(userId)) ? Response.json({ ok: true }) : jsonError("the emoji didn’t finish uploading.", 409);
    }
    if (body?.action !== "start") return jsonError("invalid request.", 400);

    const style = typeof body.style === "string" && /^[a-z0-9]{1,40}$/.test(body.style) ? body.style : null;
    const ext = typeof body.type === "string" ? TYPES[body.type] : undefined;
    const raw = Array.isArray(body.sheets) ? body.sheets : null;
    if (!style || !ext || !raw || !raw.length || raw.length > 4) return jsonError("invalid request.", 400);
    const seen = new Set<string>();
    for (const sheet of raw) {
      if (!Array.isArray(sheet) || !sheet.length || sheet.length > EMOJI_KIT_PER_SHEET) return jsonError("invalid request.", 400);
      for (const e of sheet) {
        if (!isKitEmoji(e) || seen.has(e)) return jsonError("invalid request.", 400);
        seen.add(e);
      }
    }

    const id = randomUUID();
    const kit: EmojiKit = {
      v: EMOJI_KIT_VERSION,
      style,
      cell: EMOJI_KIT_CELL,
      cols: EMOJI_KIT_COLS,
      sheets: (raw as string[][]).map((emojis, i) => ({ key: `${kitFolder(userId)}${id}-${i}.${ext}`, emojis })),
    };
    await savePending(userId, kit);
    const uploads = await Promise.all(
      kit.sheets.map((s) => createUploadUrl(s.key, { contentType: body.type as string, sizeBytes: 0, expiresIn: 1800 })),
    );
    return Response.json({ uploads });
  } catch (error) {
    console.error("Emoji kit failed:", error);
    return serverError();
  }
}
