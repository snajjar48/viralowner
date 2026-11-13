import "server-only";
import { randomUUID } from "node:crypto";
import { getAnalysisStatus, startAnalysis } from "./processing";
import {
  claimInspirationAnalysis,
  failInspiration,
  getInspiration,
  replaceInspiration,
  saveBreakdown,
  setInspirationJob,
  type Inspiration,
} from "./projects";
import {
  completeMultipartUpload,
  createMultipartUpload,
  createUploadUrl,
  deleteObject,
  headObject,
  MULTIPART_MIN_BYTES,
  readRange,
} from "./storage";
import { readMp4Duration } from "./mp4";
import {
  checkInspo,
  extensionFor,
  INSPO_MAX_BYTES,
  INSPO_MAX_SECONDS,
  MESSAGES,
  videoContentType,
} from "./video-files";

type Fail = { error: string; status: number };

/**
 * Validates the browser's description of an inspo file, records it, and
 * returns a signed URL to upload it to. The file itself is checked again
 * after upload (completeInspo), since the browser can't be trusted.
 */
export async function startInspoUpload(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
): Promise<
  | {
      upload: { url: string; headers: Record<string, string> };
      multipart: { uploadId: string; partBytes: number; urls: string[] } | null;
    }
  | Fail
> {
  if (body.styleReferenceConfirmed !== true) {
    return { status: 400, error: "please confirm you’re using this video only as a style reference." };
  }
  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
  const sizeBytes = typeof body.sizeBytes === "number" && Number.isInteger(body.sizeBytes) ? body.sizeBytes : -1;
  const durationS =
    typeof body.durationS === "number" && Number.isFinite(body.durationS) && body.durationS > 0 ? body.durationS : null;
  const contentType = videoContentType(fileName, typeof body.contentType === "string" ? body.contentType : "");
  if (!fileName || !contentType) return { status: 400, error: MESSAGES.type };

  const problem = checkInspo({ name: fileName, type: contentType, size: sizeBytes }, durationS);
  if (problem) return { status: 400, error: problem };

  const storageKey = `u/${userId}/p/${projectId}/inspo-${randomUUID()}.${extensionFor(contentType)}`;
  const oldKey = await replaceInspiration(projectId, { storageKey, fileName, contentType, sizeBytes, durationS });
  if (oldKey) await deleteObject(oldKey).catch((e) => console.error("Deleting old inspo failed:", e));

  // Big files also get a URL per part, so the browser can upload several parts at once.
  const [upload, multipart] = await Promise.all([
    createUploadUrl(storageKey, { contentType, sizeBytes }),
    sizeBytes >= MULTIPART_MIN_BYTES && body.single !== true
      ? createMultipartUpload(storageKey, { contentType, sizeBytes }).catch((error) => {
          console.error("Starting multipart upload failed (using one upload):", error);
          return null;
        })
      : null,
  ]);
  return { upload, multipart };
}

type CompleteResult = { status: number; body: Record<string, unknown> };

const ANALYSIS_FAILED = "we couldn’t analyze that video. please try again.";

/**
 * Called after the browser finishes uploading, then every few seconds by the
 * breakdown page until the shot list is ready. Safe to call any number of
 * times, from any device:
 *   - not started yet: checks the stored file for real (size, type, length
 *     read from the file itself) and starts the analysis job
 *   - running: checks on the job, and saves the breakdown when it's done
 */
export async function completeInspo(userId: string, projectId: string, uploadId?: string): Promise<CompleteResult> {
  const current = await getInspiration(userId, projectId);
  if (!current) return { status: 404, body: { error: "upload a video first." } };
  if (uploadId && current.status === "uploading") {
    // Uploaded in parts: join them into the file first.
    try {
      await completeMultipartUpload(current.storageKey, uploadId);
    } catch (error) {
      console.error("Finishing multipart inspo upload failed:", error);
      return { status: 409, body: { error: "the upload didn’t finish. please try again.", code: "upload_missing" } };
    }
  }
  if (current.status === "ready") return { status: 200, body: { status: "ready" } };
  if (current.status === "analyzing" && current.analysisJobId) return checkAnalysis(projectId, current);

  const inspo = await claimInspirationAnalysis(projectId);
  if (!inspo) {
    // Another request is starting it, or it already finished or failed.
    const now = await getInspiration(userId, projectId);
    return { status: 200, body: { status: now?.status ?? "analyzing", error: now?.error ?? null } };
  }
  return startInspoAnalysis(projectId, inspo);
}

async function startInspoAnalysis(projectId: string, inspo: Inspiration): Promise<CompleteResult> {
  const reject = async (error: string, durationS: number | null = null, deleteFile = true) => {
    await failInspiration(projectId, error, durationS);
    if (deleteFile) await deleteObject(inspo.storageKey).catch(() => {});
    return { status: 422, body: { status: "failed", error, code: deleteFile ? "invalid_file" : "upload_missing" } };
  };

  const head = await headObject(inspo.storageKey);
  if (!head) return reject("your upload didn’t finish. please upload the video again.", null, false);
  if (head.sizeBytes > INSPO_MAX_BYTES) return reject(MESSAGES.inspoTooBig(head.sizeBytes));
  if (!videoContentType("", head.contentType)) return reject(MESSAGES.type);

  const durationS = await readMp4Duration((s, e) => readRange(inspo.storageKey, s, e), head.sizeBytes);
  if (durationS === null || durationS <= 0) return reject(MESSAGES.unreadable);
  if (durationS > INSPO_MAX_SECONDS + 0.5) return reject(MESSAGES.inspoTooLong(durationS), durationS);

  try {
    const { jobId } = await startAnalysis({ inspirationId: inspo.id, storageKey: inspo.storageKey, durationS });
    await setInspirationJob(projectId, jobId, Math.round(durationS * 100) / 100);
    return { status: 200, body: { status: "analyzing", step: null, progress: 0 } };
  } catch (error) {
    console.error("Starting inspo analysis failed:", error);
    await failInspiration(projectId, ANALYSIS_FAILED, durationS);
    return { status: 502, body: { status: "failed", error: ANALYSIS_FAILED } };
  }
}

async function checkAnalysis(projectId: string, inspo: Inspiration): Promise<CompleteResult> {
  const jobId = inspo.analysisJobId!;
  let job;
  try {
    job = await getAnalysisStatus(jobId);
  } catch (error) {
    // The worker didn't answer this time; the page will ask again.
    console.error("Checking inspo analysis failed:", error);
    return { status: 200, body: { status: "analyzing", step: null, progress: 0 } };
  }

  if (job.state === "done" && job.breakdown) {
    const b = job.breakdown;
    if (b.meta) console.log(`Inspo analysis ${jobId}: ${b.shotCount} shots, $${b.meta.costUsd}, ${b.meta.seconds}s`);
    await saveBreakdown(projectId, b.durationS, b, jobId);
    return { status: 200, body: { status: "ready" } };
  }
  if (job.state === "failed") {
    const error = job.error ?? ANALYSIS_FAILED;
    await failInspiration(projectId, error, null, jobId);
    return { status: 422, body: { status: "failed", error } };
  }
  return { status: 200, body: { status: "analyzing", step: job.step, progress: job.progress } };
}
