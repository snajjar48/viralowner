"use client";

import { useEffect } from "react";
import { EMOJI_KIT_VERSION } from "@/lib/emoji-kit";
import { drawSheets, fingerprint, toBlob } from "@/lib/emoji-kit-draw";

/**
 * Draws the emoji kit with this device's own emoji (Apple's on an iPhone or Mac, Samsung's on a
 * Samsung, …) and sends it once, in the background, so the emojis in this person's videos look the
 * way they do on their phone. Draws nothing on the page. Does nothing when the account already has
 * this device's kit, or when the device has no color emoji (videos then use Google's).
 */
export function EmojiKitSync() {
  useEffect(() => {
    const id = window.setTimeout(() => void sync().catch(() => {}), 2000);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}

const DONE = "vo-emoji-kit";

let running = false;

async function sync() {
  if (running) return;
  running = true;
  try {
    const style = fingerprint();
    if (!style) return;
    const mark = `${EMOJI_KIT_VERSION}:${style}`;
    try {
      if (sessionStorage.getItem(DONE) === mark) return;
    } catch {}
    const cur = await fetch("/api/emoji-kit", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    if (!cur) return;
    if (cur.style !== style || cur.v !== EMOJI_KIT_VERSION) await upload(style);
    try {
      sessionStorage.setItem(DONE, mark);
    } catch {}
  } finally {
    running = false;
  }
}

async function upload(style: string) {
  const sheets = await drawSheets();
  if (!sheets.length) return;

  // WebP where the browser can make it (smaller), otherwise PNG.
  const first = await toBlob(sheets[0].c, "image/webp");
  const type = first?.type === "image/webp" ? "image/webp" : "image/png";
  const blobs = [type === "image/webp" ? first : await toBlob(sheets[0].c, type)];
  for (const s of sheets.slice(1)) blobs.push(await toBlob(s.c, type));
  if (blobs.some((b) => !b)) return;

  const start = await fetch("/api/emoji-kit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", style, type, sheets: sheets.map((s) => s.emojis) }),
  });
  if (!start.ok) return;
  const { uploads } = (await start.json()) as { uploads: { url: string; headers: Record<string, string> }[] };
  for (let k = 0; k < uploads.length; k++) {
    const res = await fetch(uploads[k].url, { method: "PUT", headers: uploads[k].headers, body: blobs[k] });
    if (!res.ok) return;
  }
  await fetch("/api/emoji-kit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "finish" }),
  });
}
