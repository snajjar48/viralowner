// Browser-only. Talking to the viralowner iPhone app when the site is running inside it.
//
// In the app, picking clips and sending their bytes is done natively: the app picks the original
// files from Photos (no conversion, so no wait and smaller files) and uploads them to the same signed
// URLs the site uses. Everything else (the clip rows, the upload URLs, finishing) stays here.
// In a normal browser none of this is used.

type FromApp =
  | { type: "picked"; id: string; files: NativeClip[]; error?: string }
  | { type: "progress"; ref: string; percent: number; phase?: NativePhase }
  | { type: "prepared"; ref: string; size: number; fileType: string; shrunk: boolean }
  | { type: "prepareFailed"; ref: string; error: string }
  | { type: "uploaded"; ref: string }
  | { type: "uploadFailed"; ref: string; error: string }
  | { type: "saved"; id: string }
  | { type: "saveFailed"; id: string; error: string; canceled?: boolean }
  | { type: "pushToken"; token: string };

/** What the app is doing with a clip: getting it from Photos, making it smaller, or uploading it. */
export type NativePhase = "preparing" | "shrinking" | "uploading";

/** A video picked in the app: the file stays in the app, the site only knows about it. */
export type NativeClip = { native: true; ref: string; name: string; type: string; size: number; durationS: number | null };

declare global {
  interface Window {
    __VIRALOWNER_APP__?: { version: number; platform: string };
    __voReceive?: (msg: FromApp) => void;
    ReactNativeWebView?: { postMessage: (msg: string) => void };
  }
}

/** Whether the site is running inside the viralowner app. */
export function inApp(): boolean {
  return typeof window !== "undefined" && !!window.__VIRALOWNER_APP__ && !!window.ReactNativeWebView;
}

/** The app's version (0 outside it). 3+: clips are prepared first (made smaller if big) and upload in parts. */
export function appVersion(): number {
  return (inApp() && window.__VIRALOWNER_APP__?.version) || 0;
}

export const isNativeClip = (f: unknown): f is NativeClip => !!f && typeof f === "object" && (f as NativeClip).native === true;

const listeners = new Set<(msg: FromApp) => void>();
function listen(fn: (msg: FromApp) => void) {
  if (typeof window !== "undefined" && !window.__voReceive) {
    window.__voReceive = (msg) => listeners.forEach((l) => l(msg));
  }
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function post(msg: Record<string, unknown>) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}

/** Opens the app's Photos picker for videos. Resolves with what was picked ([] if closed). */
export function pickNativeClips(limit: number): Promise<NativeClip[]> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const stop = listen((msg) => {
      if (msg.type !== "picked" || msg.id !== id) return;
      stop();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.files.map((f) => ({ ...f, native: true as const })));
    });
    post({ type: "pickClips", id, limit });
  });
}

/**
 * Uploads a picked clip's bytes to a signed PUT URL, from the app. First the app gets the video from
 * Photos ("preparing": a download if it's kept in iCloud), then it uploads it ("uploading").
 */
export function uploadNativeClip(
  clip: NativeClip,
  upload: { url: string; headers: Record<string, string> },
  onProgress: (percent: number, phase: NativePhase) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      post({ type: "cancel", ref: clip.ref });
      stop();
      reject(new DOMException("canceled", "AbortError"));
    };
    const stop = listen((msg) => {
      if (!("ref" in msg) || msg.ref !== clip.ref) return;
      if (msg.type === "progress") onProgress(msg.percent, msg.phase ?? "uploading");
      else if (msg.type === "uploaded") {
        signal?.removeEventListener("abort", onAbort);
        stop();
        resolve();
      } else if (msg.type === "uploadFailed") {
        signal?.removeEventListener("abort", onAbort);
        stop();
        reject(new Error(msg.error));
      }
    });
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    post({ type: "upload", ref: clip.ref, url: upload.url, headers: upload.headers });
  });
}

/**
 * Gets a picked clip ready in the app (from Photos; made smaller first when `shrink` and it's a big
 * vertical clip). Resolves with the file's final size and type, which its upload URLs are made for.
 */
export function prepareNativeClip(
  clip: NativeClip,
  shrink: boolean,
  onProgress: (percent: number, phase: NativePhase) => void,
  signal?: AbortSignal,
): Promise<{ size: number; type: string; shrunk: boolean }> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      stop();
      reject(new DOMException("canceled", "AbortError"));
    };
    const stop = listen((msg) => {
      if (!("ref" in msg) || msg.ref !== clip.ref) return;
      if (msg.type === "progress") onProgress(msg.percent, msg.phase ?? "preparing");
      else if (msg.type === "prepared") {
        signal?.removeEventListener("abort", onAbort);
        stop();
        resolve({ size: msg.size, type: msg.fileType, shrunk: msg.shrunk });
      } else if (msg.type === "prepareFailed") {
        signal?.removeEventListener("abort", onAbort);
        stop();
        reject(new Error(msg.error));
      }
    });
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    post({ type: "prepare", ref: clip.ref, shrink });
  });
}

/** Uploads a prepared clip from the app in parts, several at once (to URLs signed per part). */
export function uploadNativeClipParts(
  clip: NativeClip,
  multipart: { partBytes: number; urls: string[] },
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      post({ type: "cancel", ref: clip.ref });
      stop();
      reject(new DOMException("canceled", "AbortError"));
    };
    const stop = listen((msg) => {
      if (!("ref" in msg) || msg.ref !== clip.ref) return;
      if (msg.type === "progress") onProgress(msg.percent);
      else if (msg.type === "uploaded") {
        signal?.removeEventListener("abort", onAbort);
        stop();
        resolve();
      } else if (msg.type === "uploadFailed") {
        signal?.removeEventListener("abort", onAbort);
        stop();
        reject(new Error(msg.error));
      }
    });
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    post({ type: "uploadParts", ref: clip.ref, urls: multipart.urls, partBytes: multipart.partBytes });
  });
}

/** The app can let go of a picked clip's copy (removed, or uploaded and done). */
export function releaseNativeClip(clip: NativeClip) {
  post({ type: "release", ref: clip.ref });
}

/** Saves a finished video to Photos ("save") or opens the share sheet with it ("share"), from the app. */
export async function saveNativeVideo(url: string, fileName: string, mode: "save" | "share"): Promise<"done" | "canceled"> {
  // The app downloads it without this site's sign-in, so it gets the signed storage link (a full URL).
  const absolute = new URL(url, window.location.href);
  if (absolute.origin === window.location.origin) {
    absolute.searchParams.set("link", "1");
    const res = await fetch(absolute, { cache: "no-store" });
    if (!res.ok) throw new Error(`video link failed (${res.status})`);
    url = ((await res.json()) as { url: string }).url;
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const stop = listen((msg) => {
      if (!("id" in msg) || msg.id !== id) return;
      if (msg.type === "saved") {
        stop();
        resolve("done");
      } else if (msg.type === "saveFailed") {
        stop();
        if (msg.canceled) resolve("canceled");
        else reject(new Error(msg.error));
      }
    });
    post({ type: "saveVideo", id, url, fileName, mode });
  });
}

/**
 * Push notifications in the app (app 5+): `ask` shows iPhone's "allow notifications?" prompt (only the
 * first time; asked while a video is being made, when it's clearly useful). Without `ask`, a phone that
 * already allowed them just re-registers. The app answers with its push token, saved for this account.
 */
export function syncAppPush(ask: boolean) {
  if (appVersion() < 5) return;
  const stop = listen((msg) => {
    if (msg.type !== "pushToken") return;
    stop();
    void fetch("/api/push-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: msg.token }),
    }).catch(() => {});
  });
  setTimeout(stop, 60_000);
  post({ type: "enablePush", ask });
}
