"use client";

import { useEffect } from "react";
import { EMOJI_KIT_VERSION } from "@/lib/emoji-kit";
import { drawSheets, fingerprint, idle, toBlob } from "@/lib/emoji-kit-draw";

/**
 * Draws the emoji kit with this device's own emoji (Apple's on an iPhone or Mac, Samsung's on a
 * Samsung, …) and sends it once, in the background, so the emojis in this person's videos look the
 * way they do on their phone. Draws nothing on the page. Does nothing when the account already has
 * this device's kit, or when the device has no color emoji (videos then use Google's).
 */
export function EmojiKitSync() {
  useEffect(() => {
    const id = window.setTimeout(() => void sync().catch(() => {}), 4000);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}

const DONE = "vo-emoji-kit";

let running = false;

/** At most one try a day on each device (a phone on a slow connection shouldn't redo it every visit). */
const TRIED = "vo-emoji-kit-tried";
const DAY = 24 * 60 * 60 * 1000;

function stored(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function sync() {
  if (running) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g") return;
  running = true;
  try {
    await idle();
    const style = fingerprint();
    if (!style) return;
    const mark = `${EMOJI_KIT_VERSION}:${style}`;
    if (stored(DONE) === mark) return;
    const cur = await fetch("/api/emoji-kit", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    if (!cur) return;
    if (cur.style === style && cur.v === EMOJI_KIT_VERSION) {
      stored(DONE, mark);
      return;
    }
    // Uploaded last time but never finished (the page was closed): just finish it.
    if (cur.pending === style && (await finish())) {
      stored(DONE, mark);
      return;
    }
    const tried = Number(stored(TRIED) ?? 0);
    if (Date.now() - tried < DAY) return;
    stored(TRIED, String(Date.now()));
    if (await upload(style)) stored(DONE, mark);
  } finally {
    running = false;
  }
}

async function finish(): Promise<boolean> {
  const res = await fetch("/api/emoji-kit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "finish" }),
    keepalive: true,
  }).catch(() => null);
  return !!res?.ok;
}

async function upload(style: string): Promise<boolean> {
  const sheets = await drawSheets();
  if (!sheets.length) return false;

  // WebP where the browser can make it (smaller), otherwise PNG.
  const first = await toBlob(sheets[0].c, "image/webp");
  const type = first?.type === "image/webp" ? "image/webp" : "image/png";
  const blobs = [type === "image/webp" ? first : await toBlob(sheets[0].c, type)];
  for (const s of sheets.slice(1)) blobs.push(await toBlob(s.c, type));
  if (blobs.some((b) => !b)) return false;

  const start = await fetch("/api/emoji-kit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", style, type, sheets: sheets.map((s) => s.emojis) }),
  });
  if (!start.ok) return false;
  const { uploads } = (await start.json()) as { uploads: { url: string; headers: Record<string, string> }[] };
  for (let k = 0; k < uploads.length; k++) {
    const res = await fetch(uploads[k].url, { method: "PUT", headers: uploads[k].headers, body: blobs[k] });
    if (!res.ok) return false;
  }
  return finish();
}
