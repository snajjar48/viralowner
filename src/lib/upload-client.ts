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
