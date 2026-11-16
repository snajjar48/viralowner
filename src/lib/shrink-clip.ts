// Browser-only. Making big vertical clips smaller before they upload, on slow connections only.
//
// The finished video is 1080×1920, so a vertical clip 1440 pixels wide still has room for the
// editor's zooms (sharp up to 1.33×; a 2× punch-in is barely softer). Only clips where it's a clear
// win are shrunk: vertical, wider than 1440, not HDR (re-encoding HDR in the browser can wash out
// its colors), not high-frame-rate slow motion, and only when the smaller file plus the time to
// make it beats uploading the original at the speed this device is uploading at. Sideways clips
// never are (the editor crops their middle, so it needs their full height). Anything that goes
// wrong falls back to uploading the original.

export const SHRINK_WIDTH = 1440;

export type ShrinkPlan = {
  width: number;
  height: number;
  codec: "hevc" | "avc";
  bitrate: number;
  durationS: number;
  /** The shrunk file's expected size, in bytes. */
  estBytes: number;
};

const supported = () => typeof window !== "undefined" && "VideoEncoder" in window && "VideoDecoder" in window;
const lib = () => import("mediabunny");

/** Whether (and how) this clip could be shrunk; null if it shouldn't be. Reads only the file's headers. */
export async function planShrink(file: File): Promise<ShrinkPlan | null> {
  if (!supported()) return null;
  try {
    const mb = await lib();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) return null;
      const w = video.displayWidth;
      const h = video.displayHeight;
      if (!(h > w) || w <= SHRINK_WIDTH) return null; // sideways, or already small enough
      if (await video.hasHighDynamicRange()) return null;
      if (!(await video.canDecode())) return null;
      const stats = await video.computePacketStats(120);
      const fps = stats.averagePacketRate || 30;
      if (fps > 65) return null; // slow motion: keep every frame as filmed
      const durationS = await input.computeDuration();
      if (!(durationS > 0)) return null;
      const width = SHRINK_WIDTH;
      const height = Math.round((h * width) / w / 2) * 2;
      const high = fps > 40;
      // High enough that the re-encode is invisible (HEVC needs about 60% of H.264's bitrate).
      const hevc = await mb.canEncodeVideo("hevc", { width, height, bitrate: high ? 16e6 : 10e6, frameRate: fps });
      const codec = hevc ? "hevc" : "avc";
      const bitrate = hevc ? (high ? 16e6 : 10e6) : high ? 26e6 : 16e6;
      if (!hevc && !(await mb.canEncodeVideo("avc", { width, height, bitrate, frameRate: fps }))) return null;
      const audio = await input.getPrimaryAudioTrack();
      const audioBitrate = audio ? (await audio.computePacketStats(200)).averageBitrate || 256e3 : 0;
      const estBytes = ((bitrate + audioBitrate) / 8) * durationS * 1.04;
      // Not worth it unless it's a lot smaller.
      if (estBytes > file.size * 0.6) return null;
      return { width, height, codec, bitrate, durationS, estBytes };
    } finally {
      input.dispose?.();
    }
  } catch {
    return null;
  }
}

/** How many seconds of encoding one second of video takes on this device (learned as clips are shrunk). */
let encodeFactor = 1.0;

/**
 * Whether shrinking saves real time at `speed` bytes/s: making it (an estimate until this device has
 * shrunk a clip) plus uploading the smaller file, against uploading the original.
 */
export function worthShrinking(file: File, plan: ShrinkPlan, speed: number | null): boolean {
  if (!speed) return false;
  const original = file.size / speed;
  const shrunk = encodeFactor * plan.durationS + plan.estBytes / speed;
  return shrunk < original * 0.75 && original - shrunk > 15;
}

/**
 * Makes the smaller file. Gives up (throws) if it's on course to take longer than uploading the
 * original would, if it's canceled, or if anything fails: the original is uploaded then.
 */
export async function shrinkClip(
  file: File,
  plan: ShrinkPlan,
  speed: number,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  const mb = await lib();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const conversion = await mb.Conversion.init({
    input,
    output,
    video: { width: plan.width, height: plan.height, fit: "fill", codec: plan.codec, bitrate: plan.bitrate, forceTranscode: true },
    // The sound as recorded (copied, not re-encoded, when the format allows).
    audio: {},
    showWarnings: false,
  });
  try {
    if (!conversion.isValid || conversion.discardedTracks.some((t) => t.track.type === "video")) {
      throw new Error("can't shrink this clip here");
    }
    const started = Date.now();
    // The most it may take and still be worth it.
    const budget = (file.size / speed) * 0.75 - plan.estBytes / speed;
    let stop: string | null = null;
    conversion.onProgress = (p) => {
      onProgress(Math.min(99, Math.floor(p * 100)));
      const elapsed = (Date.now() - started) / 1000;
      if (elapsed > 4 && p > 0.02 && elapsed / p > budget) {
        stop = "too slow on this device";
        void conversion.cancel();
      }
    };
    const onAbort = () => void conversion.cancel();
    signal?.addEventListener("abort", onAbort);
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    if (stop) throw new Error(stop);
    if (signal?.aborted) throw new Error("canceled");
    const buffer = target.buffer;
    if (!buffer || buffer.byteLength < 1024) throw new Error("empty result");
    encodeFactor = ((Date.now() - started) / 1000 / plan.durationS) * 0.5 + encodeFactor * 0.5;
    const name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
    return new File([buffer], name, { type: "video/mp4", lastModified: file.lastModified });
  } catch (error) {
    // A device that couldn't keep up: don't plan on it next time either.
    encodeFactor = Math.max(encodeFactor, 1.5);
    throw error;
  } finally {
    input.dispose?.();
  }
}
