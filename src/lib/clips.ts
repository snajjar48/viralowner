import "server-only";
import { randomUUID } from "node:crypto";
import { readMp4Duration } from "./mp4";
import { createClip, getClip, markClipFailed, markClipUploaded, type Clip } from "./projects";
import { createUploadUrl, deleteObject, headObject, readRange } from "./storage";
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

/** Validates a clip's details, records it, and returns where to upload it. */
export async function startClipUpload(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ clip: Clip; upload: { url: string; headers: Record<string, string> } } | Fail> {
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
  return { clip, upload: await createUploadUrl(storageKey, { contentType, sizeBytes }) };
}

/** After upload: checks the stored file for real, then marks the clip ready. */
export async function completeClip(projectId: string, clipId: string) {
  const clip = await getClip(projectId, clipId);
  if (!clip) return { status: 404, body: { error: "we couldn’t find that clip." } };
  if (clip.status === "uploaded") return { status: 200, body: { clip } };

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
