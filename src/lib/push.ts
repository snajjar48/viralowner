import "server-only";
import { getSql } from "./db";

/**
 * Push notifications to the iPhone app, sent through Expo's push service (the app registers an Expo
 * push token for the signed-in account). Failing to send never breaks anything else: the email still goes.
 */

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;

export const isPushToken = (t: unknown): t is string => typeof t === "string" && EXPO_TOKEN.test(t);

/** This phone now gets the notifications for this account. */
export async function savePushToken(userId: string, token: string) {
  await getSql()`
    INSERT INTO push_tokens (token, user_id, updated_at) VALUES (${token}, ${userId}, now())
    ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now()`;
}

export async function removePushToken(userId: string, token: string) {
  await getSql()`DELETE FROM push_tokens WHERE token = ${token} AND user_id = ${userId}`;
}

export async function removeUserPushTokens(userId: string) {
  await getSql()`DELETE FROM push_tokens WHERE user_id = ${userId}`.catch(() => {});
}

/** Sends one notification to every phone signed in to this account. `path`: the page it opens. */
export async function sendPush(userId: string, note: { title: string; body: string; path: string }) {
  try {
    const sql = getSql();
    const rows = await sql`SELECT token FROM push_tokens WHERE user_id = ${userId}`;
    if (!rows.length) return;
    const tokens = rows.map((r) => String(r.token));
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(
        tokens.map((to) => ({ to, title: note.title, body: note.body, sound: "default", data: { path: note.path } })),
      ),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return console.error(`Push send failed (${res.status})`);
    const out = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
    // Phones that uninstalled the app or turned notifications off: stop sending to them.
    const gone = tokens.filter((_, k) => out?.data?.[k]?.details?.error === "DeviceNotRegistered");
    if (gone.length) await sql`DELETE FROM push_tokens WHERE token = ANY(${gone})`;
  } catch (error) {
    console.error("Push send failed:", error);
  }
}
