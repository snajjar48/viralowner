import "server-only";
import { randomUUID } from "node:crypto";
import { describeMp4, readMp4Duration } from "./mp4";
import { createClip, getClip, markClipFailed, markClipUploaded, type Clip } from "./projects";
import { workerFetch } from "./worker";
import {
  completeMultipartUpload,
  createDownloadUrl,
  createMultipartUpload,
  createUploadUrl,
  deleteObject,
  headObject,
  MULTIPART_MIN_BYTES,
  readRange,
} from "./storage";
import {
  checkClip,
  CLIP_MAX_BYTES,
  CLIP_MAX_SECONDS,
  extensionFor,
  MAX_CLIPS,
  MESSAGES,
  videoContentType,
} from "./video-files";

type Fail = { error: string; status: number };
type SignedPut = { url: string; headers: Record<string, string> };

/** Where a clip's still (a JPEG the browser makes when the clip is picked) is kept. */
export const thumbKeyFor = (clipKey: string) => `${clipKey}.jpg`;

/** A clip's still, to show instead of loading the video itself. The page falls back to the video if it's missing. */
export const clipThumbUrl = (clipKey: string) => createDownloadUrl(thumbKeyFor(clipKey), { expiresIn: 6 * 3600 });

/** A clip's small preview copy (the worker makes it): what the editor plays and trims on. */
export const previewKeyFor = (clipKey: string) => `${clipKey}.preview.mp4`;

/** Asks the worker to make a clip's preview copy (takes it a few seconds; nothing waits for it). */
export async function requestPreview(clipKey: string) {
  try {
    await workerFetch("/jobs/preview", { method: "POST", body: { storageKey: clipKey }, timeoutMs: 15_000 });
  } catch (error) {
    console.error("Requesting a clip preview failed:", error);
  }
}

/**
 * Where the editor plays a clip from: its preview copy when it's made (small, quick to drag
 * through), else the original, and asks for the copy so it's there next time.
 */
export async function clipPreviewUrl(clipKey: string) {
  if (await headObject(previewKeyFor(clipKey)).catch(() => null)) {
    return createDownloadUrl(previewKeyFor(clipKey), { expiresIn: 6 * 3600 });
  }
  void requestPreview(clipKey);
  return createDownloadUrl(clipKey, { expiresIn: 6 * 3600 });
}

/**
 * Validates a clip's details, records it, and returns where to upload it: one URL, plus, for big
 * files, a URL per part so they upload several parts at once (much faster). Also where to put its still.
 */
export async function startClipUpload(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
): Promise<
  | {
      clip: Clip;
      upload: SignedPut;
      multipart: { uploadId: string; partBytes: number; urls: string[] } | null;
      thumb: SignedPut;
    }
  | Fail
> {
  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
  const sizeBytes = typeof body.sizeBytes === "number" && Number.isInteger(body.sizeBytes) ? body.sizeBytes : -1;
  const durationS =
    typeof body.durationS === "number" && Number.isFinite(body.durationS) && body.durationS > 0 ? body.durationS : null;
  const contentType = videoContentType(fileName, typeof body.contentType === "string" ? body.contentType : "");
  if (!fileName || !contentType) return { status: 400, error: MESSAGES.type };
  const problem = checkClip({ name: fileName, type: contentType, size: sizeBytes }, durationS);
  if (problem) return { status: 400, error: problem };

  const storageKey = `u/${userId}/p/${projectId}/clips/${randomUUID()}.${extensionFor(contentType)}`;
  const clip = await createClip(projectId, { storageKey, fileName, contentType, sizeBytes, durationS }, MAX_CLIPS);
  if (!clip) return { status: 409, error: `you can add up to ${MAX_CLIPS} clips. remove one to add another.` };
  const [upload, multipart, thumb] = await Promise.all([
    createUploadUrl(storageKey, { contentType, sizeBytes }),
    sizeBytes >= MULTIPART_MIN_BYTES
      ? createMultipartUpload(storageKey, { contentType, sizeBytes }).catch((error) => {
          console.error("Starting multipart upload failed (using one upload):", error);
          return null;
        })
      : null,
    createUploadUrl(thumbKeyFor(storageKey), { contentType: "image/jpeg", sizeBytes: 0 }),
  ]);
  return { clip, upload, multipart, thumb };
}

/**
 * Asks the worker to make a clip's still from the uploaded file (when the browser couldn't).
 * Best effort: the page falls back to the video itself.
 */
async function requestThumb(clipKey: string) {
  try {
    await workerFetch("/jobs/thumb", { method: "POST", body: { storageKey: clipKey }, timeoutMs: 15_000 });
  } catch (error) {
    console.error("Requesting a clip still failed:", error);
  }
}

/** After upload: checks the stored file for real, then marks the clip ready. */
export async function completeClip(projectId: string, clipId: string, uploadId?: string, hasThumb = true) {
  const clip = await getClip(projectId, clipId);
  if (!clip) return { status: 404, body: { error: "we couldn’t find that clip." } };
  if (clip.status === "uploaded") return { status: 200, body: { clip } };
  if (uploadId) {
    // Uploaded in parts: join them into the file first.
    try {
      await completeMultipartUpload(clip.storageKey, uploadId);
    } catch (error) {
      console.error("Finishing multipart upload failed:", error);
      return { status: 409, body: { error: "the upload didn’t finish. please try again." } };
    }
  }

  const reject = async (error: string) => {
    await markClipFailed(clip.id);
    await deleteObject(clip.storageKey).catch(() => {});
    return { status: 422, body: { error } };
  };

  const head = await headObject(clip.storageKey);
  if (!head) return { status: 409, body: { error: "the upload didn’t finish. please try again." } };
  if (head.sizeBytes > CLIP_MAX_BYTES) return reject(MESSAGES.clipTooBig(head.sizeBytes));
  if (!videoContentType("", head.contentType)) return reject(MESSAGES.type);
  const read = await readMp4Duration((s, e) => readRange(clip.storageKey, s, e), head.sizeBytes);
  // 0 (a real video whose length isn't in its headers) or unreadable here: the length the device
  // reported (it played it to read that), and the file is checked again for real when it's processed.
  if (read === null) console.error("Video header unreadable, using the device's length:", clip.durationS, await describeMp4((s, e) => readRange(clip.storageKey, s, e), head.sizeBytes));
  const durationS = read === 0 || read === null ? clip.durationS : read;
  if (durationS === null || durationS <= 0) return reject(MESSAGES.unreadable);
  if (durationS > CLIP_MAX_SECONDS + 0.5) return reject(MESSAGES.clipTooLong(durationS));

  const rounded = Math.round(durationS * 100) / 100;
  await markClipUploaded(clip.id, rounded, head.sizeBytes);
  await Promise.all([hasThumb ? null : requestThumb(clip.storageKey), requestPreview(clip.storageKey)]);
  return {
    status: 200,
    body: {
      clip: { ...clip, status: "uploaded", durationS: rounded, sizeBytes: head.sizeBytes },
      thumbUrl: await clipThumbUrl(clip.storageKey),
    },
  };
}
