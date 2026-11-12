import "server-only";
import { randomUUID } from "node:crypto";
import { AUDIO_MAX_BYTES, AUDIO_MESSAGES, audioContentType, audioExtension, checkAudio } from "./audio-files";
import { saveSettings, setProjectAudio, type Project, type ProjectAudio } from "./projects";
import { createDownloadUrl, createUploadUrl, deleteObject, headObject } from "./storage";

type Fail = { error: string; status: number };

/** Starts replacing the project's own audio file: checks it, records it, returns where to upload it. */
export async function startAudioUpload(
  userId: string,
  project: Project,
  body: Record<string, unknown>,
): Promise<{ upload: { url: string; headers: Record<string, string> } } | Fail> {
  if (body.rightsConfirmed !== true) return { status: 400, error: AUDIO_MESSAGES.confirm };
  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";
  const sizeBytes = typeof body.sizeBytes === "number" && Number.isInteger(body.sizeBytes) ? body.sizeBytes : -1;
  const contentType = audioContentType(fileName, typeof body.contentType === "string" ? body.contentType : "");
  const problem = checkAudio({ name: fileName, type: contentType ?? "", size: sizeBytes });
  if (problem || !contentType) return { status: 400, error: problem ?? AUDIO_MESSAGES.type };
  const durationS =
    typeof body.durationS === "number" && Number.isFinite(body.durationS) && body.durationS > 0
      ? Math.round(body.durationS * 100) / 100
      : null;

  const storageKey = `u/${userId}/p/${project.id}/audio-${randomUUID()}.${audioExtension(contentType)}`;
  const audio: ProjectAudio = {
    storageKey,
    fileName,
    contentType,
    sizeBytes,
    durationS,
    status: "uploading",
    rightsConfirmedAt: new Date().toISOString(),
  };
  const oldKey = await setProjectAudio(project.id, audio);
  if (oldKey) await deleteObject(oldKey).catch((e) => console.error("Deleting old audio failed:", e));
  return { upload: await createUploadUrl(storageKey, { contentType, sizeBytes }) };
}

/** After the browser uploads: checks the stored file and makes it the video's sound. */
export async function completeAudio(project: Project): Promise<{ audio: AudioView } | Fail> {
  const audio = project.audio;
  if (!audio) return { status: 404, error: "upload an audio file first." };
  const head = await headObject(audio.storageKey);
  const reject = async (error: string) => {
    await setProjectAudio(project.id, null);
    await deleteObject(audio.storageKey).catch(() => {});
    return { status: 422, error };
  };
  if (!head) return reject("your upload didn’t finish. please upload the audio file again.");
  if (head.sizeBytes > AUDIO_MAX_BYTES) return reject(AUDIO_MESSAGES.tooBig(head.sizeBytes));
  if (!audioContentType("", head.contentType)) return reject(AUDIO_MESSAGES.type);

  const done: ProjectAudio = { ...audio, sizeBytes: head.sizeBytes, status: "uploaded" };
  await setProjectAudio(project.id, done);
  // They just added it, so use it (they can switch back in the options step).
  await saveSettings(project.id, { ...project.settings, music: { ...project.settings.music, mode: "upload" } });
  return { audio: (await audioView(done))! };
}

/** Removes the project's own audio file (and stops using it). */
export async function removeAudio(project: Project) {
  const oldKey = await setProjectAudio(project.id, null);
  if (oldKey) await deleteObject(oldKey).catch((e) => console.error("Deleting audio failed:", e));
  if (project.settings.music.mode === "upload") {
    await saveSettings(project.id, { ...project.settings, music: { ...project.settings.music, mode: "original" } });
  }
}

/** What the pages show about the audio file. */
export interface AudioView {
  fileName: string;
  durationS: number | null;
  previewUrl: string;
}

export async function audioView(audio: ProjectAudio | null): Promise<AudioView | null> {
  if (!audio || audio.status !== "uploaded") return null;
  return {
    fileName: audio.fileName,
    durationS: audio.durationS,
    previewUrl: await createDownloadUrl(audio.storageKey, { expiresIn: 6 * 3600 }),
  };
}
