import "server-only";
import { randomUUID } from "node:crypto";
import { readMp4Duration } from "./mp4";
import { createClip, getClip, markClipFailed, markClipUploaded, type Clip } from "./projects";
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

/** After upload: checks the stored file for real, then marks the clip ready. */
export async function completeClip(projectId: string, clipId: string, uploadId?: string) {
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
  const durationS = await readMp4Duration((s, e) => readRange(clip.storageKey, s, e), head.sizeBytes);
  if (durationS === null || durationS <= 0) return reject(MESSAGES.unreadable);
  if (durationS > CLIP_MAX_SECONDS + 0.5) return reject(MESSAGES.clipTooLong(durationS));

  const rounded = Math.round(durationS * 100) / 100;
  await markClipUploaded(clip.id, rounded, head.sizeBytes);
  return { status: 200, body: { clip: { ...clip, status: "uploaded", durationS: rounded, sizeBytes: head.sizeBytes } } };
}
