// Browser-only helpers for uploading videos straight to storage.

/**
 * Reads a video's length from its metadata, in the browser. Resolves to null
 * if the browser can't read it (some formats only play on some devices); the
 * server checks the length again either way.
 */
export function readVideoDuration(file: File, timeoutMs = 10_000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

export class UploadError extends Error {}

/**
 * PUTs a file to a signed URL with real progress (0–100). XMLHttpRequest,
 * because fetch can't report upload progress.
 */
export function uploadToSignedUrl(
  file: File,
  upload: { url: string; headers: Record<string, string> },
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const fileInfo = () => ({
    fileType: file.type,
    fileExt: file.name.split(".").pop()?.toLowerCase(),
    sizeBytes: file.size,
    online: navigator.onLine,
  });
  // Make sure the browser can still read the file before uploading (iOS can
  // lose access to a picked video), so we can say what actually went wrong.
  return file
    .slice(0, 1)
    .arrayBuffer()
    .then(
      () => send(file, upload, onProgress, fileInfo, signal),
      () => {
        reportUploadError({ kind: "unreadable", ...fileInfo() });
        throw new UploadError("we lost access to that video. please pick it again.");
      },
    );
}

function send(
  file: File,
  upload: { url: string; headers: Record<string, string> },
  onProgress: (percent: number) => void,
  fileInfo: () => Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();
    let loaded = 0;
    const report = (kind: string) =>
      reportUploadError({
        kind,
        ...fileInfo(),
        status: xhr.status,
        loadedBytes: loaded,
        elapsedMs: Date.now() - startedAt,
      });

    xhr.open("PUT", upload.url);
    for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      loaded = e.loaded;
      if (e.lengthComputable) onProgress(Math.min(99, Math.floor((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        report("http");
        reject(new UploadError("the upload didn’t go through. please try again."));
      }
    };
    xhr.onerror = () => {
      report("network");
      reject(new UploadError("the upload stopped. check your connection and try again."));
    };
    xhr.onabort = () => reject(new UploadError("upload canceled."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/** Parts uploading at once for one file. More parallel streams fill the connection better. */
const PART_CONCURRENCY = 4;

/**
 * Uploads a big file in parts, several at once (to URLs signed per part), with real progress.
 * Each part is retried a couple of times before giving up. The server joins the parts after.
 */
export async function uploadInParts(
  file: File,
  multipart: { partBytes: number; urls: string[] },
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const fileInfo = () => ({
    fileType: file.type,
    fileExt: file.name.split(".").pop()?.toLowerCase(),
    sizeBytes: file.size,
    online: navigator.onLine,
    multipart: true,
  });
  try {
    await file.slice(0, 1).arrayBuffer();
  } catch {
    reportUploadError({ kind: "unreadable", ...fileInfo() });
    throw new UploadError("we lost access to that video. please pick it again.");
  }
  const { partBytes, urls } = multipart;
  if (Math.ceil(file.size / partBytes) !== urls.length) throw new UploadError("the upload didn’t go through. please try again.");
  const sent = new Array<number>(urls.length).fill(0);
  const tell = () => onProgress(Math.min(99, Math.floor((sent.reduce((a, b) => a + b, 0) / file.size) * 100)));
  let next = 0;

  const putPart = (i: number) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", urls[i]);
      xhr.upload.onprogress = (e) => {
        sent[i] = e.loaded;
        tell();
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`part ${i + 1}: ${xhr.status}`)));
      xhr.onerror = () => reject(new Error(`part ${i + 1}: network`));
      xhr.onabort = () => reject(new UploadError("upload canceled."));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(file.slice(i * partBytes, Math.min(file.size, (i + 1) * partBytes)));
    });

  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      for (let attempt = 0; ; attempt++) {
        try {
          await putPart(i);
          sent[i] = Math.min(partBytes, file.size - i * partBytes);
          tell();
          break;
        } catch (error) {
          if (signal?.aborted || error instanceof UploadError) throw error;
          sent[i] = 0;
          if (attempt >= 2) {
            reportUploadError({ kind: "part", ...fileInfo(), detail: String(error) });
            throw new UploadError("the upload stopped. check your connection and try again.");
          }
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, urls.length) }, worker));
  onProgress(100);
}

/**
 * A still of a video, made in the browser from the picked file (fast: nothing is downloaded), as a
 * small JPEG. Null when the browser can't decode the video; the page then shows the video itself.
 */
export function makeVideoThumbnail(file: File, width = 360, timeoutMs = 8_000): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (blob: Blob | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = () => {
      // A moment in, past any black first frame.
      video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
    };
    video.onseeked = () => {
      try {
        const height = Math.round((width * 16) / 9);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!ctx || !vw || !vh) return finish(null);
        // Cover the 9:16 frame, like the finished video.
        const scale = Math.max(width / vw, height / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
        canvas.toBlob((b) => finish(b), "image/jpeg", 0.78);
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** Tells our server an upload failed (best effort, never throws). */
function reportUploadError(details: Record<string, unknown>) {
  try {
    const body = JSON.stringify(details);
    if (!navigator.sendBeacon?.("/api/upload-errors", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/upload-errors", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

/** POST JSON to our API; returns the parsed body or throws with a friendly message. */
export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new UploadError("network error. check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new UploadError(data.error ?? "something went wrong. please try again."), { data });
  }
  return data as T;
}

/** From a "version N is still being made" reply: that version's id, to show its progress instead. */
export function activeRenderIdFrom(error: unknown): string | null {
  const id = (error as { data?: { renderId?: unknown } } | null)?.data?.renderId;
  return typeof id === "string" ? id : null;
}
