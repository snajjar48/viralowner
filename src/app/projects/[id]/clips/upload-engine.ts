"use client";

// A project's clip uploads, kept outside the clips page so they keep going when people move on:
// to the options step, or while they write their idea on the same page. One engine per project
// (in this tab); the clips page shows it and adds to it, other pages can show how it's going and
// wait for it (waitForUploads) before they start a video.

import {
  makeVideoThumbnail,
  postJson,
  readVideoDuration,
  uploadInParts,
  uploadSpeed,
  uploadToSignedUrl,
  UploadError,
} from "@/lib/upload-client";
import {
  appVersion,
  isNativeClip,
  prepareNativeClip,
  releaseNativeClip,
  uploadNativeClip,
  uploadNativeClipParts,
  type NativeClip,
} from "@/lib/native-app";
import { planShrink, shrinkClip, worthShrinking, type ShrinkPlan } from "@/lib/shrink-clip";
import { checkClip, MAX_CLIPS } from "@/lib/video-files";

export interface InitialClip {
  id: string;
  fileName: string | null;
  durationS: number | null;
  /** The shots it's on (one long clip can fill several). */
  shotIndexes: number[];
  /** "Start from scratch": cut it into several shots. */
  multiUse?: boolean;
  status: "uploading" | "uploaded" | "failed";
  previewUrl: string | null;
  /** The clip's saved still, if it has one. */
  thumbUrl?: string | null;
}

export type ItemStatus = "queued" | "shrinking" | "fetching" | "uploading" | "verifying" | "uploaded" | "failed";
export interface Item {
  key: string;
  clipId: string | null;
  fileName: string;
  durationS: number | null;
  previewUrl: string | null;
  /** A still of the clip: made in this browser when it's picked, or the saved one. */
  thumbUrl: string | null;
  shotIndexes: number[];
  multiUse: boolean;
  status: ItemStatus;
  percent: number;
  error: string | null;
  /** False when the file isn't in this browser any more (e.g. after a refresh). */
  canRetry: boolean;
  /** Bytes to send (for the overall progress). */
  size: number;
}

// Clips uploading at once. Big clips upload several parts at once too (uploadInParts).
const CONCURRENCY = 3;
type SignedPut = { url: string; headers: Record<string, string> };

export const inFlight = (s: ItemStatus) =>
  s === "queued" || s === "shrinking" || s === "fetching" || s === "uploading" || s === "verifying";

export class UploadEngine {
  items: Item[];
  private listeners = new Set<() => void>();
  // The picked files. In the viralowner app, the app keeps the video and this is a stand-in for it.
  private files = new Map<string, File | NativeClip>();
  // Each clip's still is saved next to it once both the still and its upload URL are ready.
  private thumbs = new Map<string, Blob>();
  private thumbTargets = new Map<string, SignedPut>();
  private aborts = new Map<string, AbortController>();
  private queue: string[] = [];
  private active = 0;
  // Big vertical clips that could be made smaller first, on a slow connection (lib/shrink-clip.ts).
  private plans = new Map<string, ShrinkPlan>();
  private planning = new Map<string, Promise<ShrinkPlan | null>>();
  // Uploads sending bytes right now (their progress measures this device's upload speed).
  private sending = 0;
  // One clip is shrunk at a time (each takes the phone's video encoder).
  private shrinking: Promise<unknown> = Promise.resolve();

  constructor(
    readonly projectId: string,
    initialClips: InitialClip[],
  ) {
    this.items = fromServer(initialClips);
  }

  /** Starts over from the server's list (only when nothing is uploading or picked here). */
  reset(initialClips: InitialClip[]) {
    // (Called while a page renders: others hear about it just after, not mid-render.)
    this.items = fromServer(initialClips);
    queueMicrotask(() => this.listeners.forEach((l) => l()));
  }

  // ---- The list, for useSyncExternalStore.

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  get = () => this.items;
  set = (next: Item[] | ((list: Item[]) => Item[])) => {
    this.items = typeof next === "function" ? next(this.items) : next;
    this.listeners.forEach((l) => l());
  };
  private patch = (key: string, change: Partial<Item>) =>
    this.set((list) => list.map((it) => (it.key === key ? { ...it, ...change } : it)));
  private find = (key: string) => this.items.find((i) => i.key === key);

  get busy() {
    return this.items.some((i) => inFlight(i.status));
  }

  /**
   * On a slow connection, a big vertical clip is made smaller before it uploads, when that's
   * quicker overall (lib/shrink-clip.ts). Returns the file to upload: the smaller one, or the
   * original whenever shrinking isn't worth it or doesn't work.
   */
  private async maybeShrink(key: string, file: File, signal: AbortSignal): Promise<File> {
    const plan = this.plans.get(key);
    if (!plan) return file;
    // No speed measured yet: while other clips upload, wait a few seconds for one.
    for (let waited = 0; !uploadSpeed() && this.sending > 0 && waited < 12; waited++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (signal.aborted) return file;
    }
    const speed = uploadSpeed();
    if (!speed || !worthShrinking(file, plan, speed)) return file;
    let release = () => {};
    const turn = this.shrinking;
    this.shrinking = new Promise<void>((r) => (release = r));
    try {
      await turn;
      if (signal.aborted) return file;
      this.patch(key, { status: "shrinking", percent: 0 });
      const smaller = await shrinkClip(file, plan, speed, (percent) => this.patch(key, { percent }), signal);
      this.plans.delete(key);
      this.files.set(key, smaller); // (a retry uploads the smaller one too)
      this.patch(key, { size: smaller.size });
      return smaller;
    } catch {
      this.plans.delete(key);
      return file;
    } finally {
      release();
    }
  }

  private async uploadOne(key: string) {
    let file = this.files.get(key);
    const item = this.find(key);
    if (!file || !item) return;
    const controller = new AbortController();
    this.aborts.set(key, controller);
    let counted = false;
    try {
      // Whether it could be made smaller (worked out when it was picked; never waited on for long).
      const pending = this.planning.get(key);
      if (pending) {
        this.planning.delete(key);
        const plan = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
        if (plan) this.plans.set(key, plan);
      }
      // Nothing has measured the upload speed yet: this one goes as is and measures it for the rest.
      if (this.plans.has(key) && !uploadSpeed() && this.sending === 0) this.plans.delete(key);
      if (!this.plans.has(key)) {
        this.sending++;
        counted = true;
      }
      if (!isNativeClip(file)) file = await this.maybeShrink(key, file, controller.signal);
      if (controller.signal.aborted) return;
      if (!counted) {
        this.sending++;
        counted = true;
      }

      // In the app (3+): it gets the clip ready first (from Photos, made smaller if it's big), so the
      // upload URLs are made for the file it really sends, in parts.
      let native: { size: number; type: string; name: string } | null = null;
      if (isNativeClip(file) && appVersion() >= 3) {
        const clipFile = file;
        this.patch(key, { status: "fetching", percent: 0, error: null });
        const ready = await prepareNativeClip(
          clipFile,
          true,
          (percent, phase) => this.patch(key, { percent, status: phase === "shrinking" ? "shrinking" : "fetching" }),
          controller.signal,
        );
        const name = ready.shrunk ? clipFile.name.replace(/\.[^.]+$/, "") + ".mov" : clipFile.name;
        native = { size: ready.size, type: ready.type, name };
        this.patch(key, { size: ready.size });
      }

      this.patch(key, { status: "uploading", percent: 0, error: null });
      const { clip, upload, multipart, thumb } = await postJson<{
        clip: { id: string };
        upload: SignedPut;
        multipart: { uploadId: string; partBytes: number; urls: string[] } | null;
        thumb: SignedPut;
      }>(`/api/projects/${this.projectId}/clips`, {
        fileName: native?.name ?? file.name,
        contentType: native?.type ?? file.type,
        sizeBytes: native?.size ?? file.size,
        durationS: item.durationS,
      });
      this.patch(key, { clipId: clip.id });
      this.thumbTargets.set(key, thumb);
      this.saveThumb(key);
      const onProgress = (percent: number) => this.patch(key, { percent });
      let uploadId: string | undefined;
      if (isNativeClip(file) && native && multipart) {
        // In the app, in parts.
        await uploadNativeClipParts(file, multipart, onProgress, controller.signal);
        uploadId = multipart.uploadId;
      } else if (isNativeClip(file)) {
        // In the app: the app sends the file in one go (it uploads in the background too).
        await uploadNativeClip(
          file,
          upload,
          (percent, phase) => this.patch(key, { percent, status: phase === "uploading" ? "uploading" : "fetching" }),
          controller.signal,
        );
      } else if (multipart) {
        try {
          await uploadInParts(file, multipart, onProgress, controller.signal);
          uploadId = multipart.uploadId;
        } catch (e) {
          if (controller.signal.aborted) throw e;
          // Parts didn't work on this connection: send it in one go instead.
          onProgress(0);
          await uploadToSignedUrl(file as File, upload, onProgress, controller.signal);
        }
      } else {
        await uploadToSignedUrl(file, upload, onProgress, controller.signal);
      }
      this.patch(key, { status: "verifying" });
      // Without a still made here, the server has one made from the uploaded file.
      const hasThumb = () => !!this.find(key)?.thumbUrl || this.thumbs.has(key);
      const complete = (id?: string) =>
        postJson<{ clip: { durationS: number }; thumbUrl?: string }>(
          `/api/projects/${this.projectId}/clips/${clip.id}/complete`,
          { ...(id ? { uploadId: id } : {}), hasThumb: hasThumb() },
        );
      let done;
      try {
        done = await complete(uploadId);
      } catch (e) {
        if (!uploadId || isNativeClip(file)) throw e;
        // The parts couldn't be joined: send it in one go instead.
        this.patch(key, { status: "uploading", percent: 0 });
        await uploadToSignedUrl(file as File, upload, onProgress, controller.signal);
        this.patch(key, { status: "verifying" });
        done = await complete();
      }
      this.patch(key, { status: "uploaded", percent: 100, durationS: done.clip.durationS });
      if (isNativeClip(file)) {
        releaseNativeClip(file); // the app's copy isn't needed any more
        this.files.delete(key);
      }
      if (!hasThumb() && done.thumbUrl) void this.waitForThumb(key, done.thumbUrl);
    } catch (e) {
      if (controller.signal.aborted) return; // removed by the user
      this.patch(key, {
        status: "failed",
        error: e instanceof UploadError || (isNativeClip(file) && e instanceof Error) ? e.message : "the upload didn’t go through.",
      });
    } finally {
      if (counted) this.sending--;
      this.aborts.delete(key);
    }
  }

  /** Saves a clip's still to storage once both it and the clip's upload URL are ready (best effort). */
  private saveThumb(key: string) {
    const blob = this.thumbs.get(key);
    const target = this.thumbTargets.get(key);
    if (!blob || !target) return;
    this.thumbs.delete(key);
    void fetch(target.url, { method: "PUT", headers: target.headers, body: blob }).catch(() => {});
  }

  /** Makes stills for newly picked clips, one at a time (each decodes a bit of video). */
  private async makeThumbs(keys: string[]) {
    const missed: string[] = [];
    const make = async (key: string, timeoutMs: number) => {
      const file = this.files.get(key);
      if (!file || isNativeClip(file)) return true; // the app's clips get their still from the server
      const blob = await makeVideoThumbnail(file, 360, timeoutMs);
      if (!blob || !this.files.has(key)) return false;
      this.thumbs.set(key, blob);
      this.patch(key, { thumbUrl: URL.createObjectURL(blob) });
      this.saveThumb(key);
      return true;
    };
    for (const key of keys) if (!(await make(key, 8_000))) missed.push(key);
    // A second try for any that didn't work (the first often loses out to everything starting at once).
    for (const key of missed) await make(key, 15_000);
  }

  /** Shows the still the server is making once it's ready (checks every couple of seconds for a while). */
  private async waitForThumb(key: string, url: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, attempt ? 2500 : 1500));
      if (!this.find(key) || this.find(key)?.thumbUrl) return;
      const ok = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url; // (a signed link: adding anything to it would break the signature)
      });
      if (ok) return this.patch(key, { thumbUrl: url });
    }
  }

  private pump() {
    while (this.active < CONCURRENCY && this.queue.length) {
      const key = this.queue.shift()!;
      this.active++;
      void this.uploadOne(key).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  /** Adds picked files and starts uploading them. Returns what was skipped and why. */
  async addFiles(picked: (File | NativeClip)[]): Promise<string[]> {
    const room = MAX_CLIPS - this.items.filter((i) => i.status !== "failed").length;
    const problems: string[] = [];
    if (picked.length > room) {
      problems.push(`you can add up to ${MAX_CLIPS} clips, so we skipped ${picked.length - Math.max(0, room)}.`);
      picked = picked.slice(0, Math.max(0, room));
    }
    const added: Item[] = [];
    // Read every picked file's length at once (one at a time made picking 20 clips slow). A clip
    // this browser can't read doesn't hold the others up for long: the server reads it anyway.
    const durations = await Promise.all(
      picked.map((f) => (isNativeClip(f) ? f.durationS : checkClip(f, null) ? null : readVideoDuration(f, 3_000))),
    );
    for (const [i, file] of picked.entries()) {
      const durationS = durations[i];
      const problem = checkClip(file, durationS);
      if (problem) {
        problems.push(`${file.name}: ${problem}`);
        continue;
      }
      const key = `local-${crypto.randomUUID()}`;
      this.files.set(key, file);
      added.push({
        key,
        clipId: null,
        fileName: file.name,
        durationS,
        previewUrl: isNativeClip(file) ? null : URL.createObjectURL(file),
        thumbUrl: null,
        shotIndexes: [],
        multiUse: false,
        status: "queued",
        percent: 0,
        error: null,
        canRetry: true,
        size: file.size,
      });
    }
    if (!added.length) return problems;
    this.set((list) => [...list, ...added]);
    // Big vertical clips: could they be made smaller (only used on a slow connection)?
    for (const a of added) {
      const f = this.files.get(a.key);
      if (f && !isNativeClip(f) && f.size > 40 * 1024 * 1024) this.planning.set(a.key, planShrink(f));
    }
    this.queue.push(...uploadOrder(added));
    this.pump();
    void this.makeThumbs(added.map((a) => a.key));
    return problems;
  }

  retry(item: Item) {
    if (item.clipId) {
      // Start fresh: the failed clip row and any partial file go away.
      void fetch(`/api/projects/${this.projectId}/clips/${item.clipId}`, { method: "DELETE" });
    }
    this.patch(item.key, { clipId: null, status: "queued", percent: 0, error: null });
    this.queue.push(item.key);
    this.pump();
  }

  /** Stops and removes a clip. Resolves false if the server couldn't delete it. */
  async remove(item: Item): Promise<boolean> {
    this.aborts.get(item.key)?.abort();
    this.queue = this.queue.filter((k) => k !== item.key);
    this.set((list) => list.filter((i) => i.key !== item.key));
    if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    if (item.thumbUrl?.startsWith("blob:")) URL.revokeObjectURL(item.thumbUrl);
    const picked = this.files.get(item.key);
    if (isNativeClip(picked)) releaseNativeClip(picked);
    this.files.delete(item.key);
    this.thumbs.delete(item.key);
    this.thumbTargets.delete(item.key);
    if (!item.clipId) return true;
    const res = await fetch(`/api/projects/${this.projectId}/clips/${item.clipId}`, { method: "DELETE" }).catch(() => null);
    return !!res?.ok || res?.status === 404;
  }
}

function fromServer(initialClips: InitialClip[]): Item[] {
  return initialClips.map((c) => ({
    key: c.id,
    clipId: c.id,
    fileName: c.fileName ?? "clip",
    durationS: c.durationS,
    previewUrl: c.previewUrl,
    thumbUrl: c.thumbUrl ?? null,
    shotIndexes: c.shotIndexes,
    multiUse: !!c.multiUse,
    status: c.status === "uploaded" ? "uploaded" : "failed",
    percent: c.status === "uploaded" ? 100 : 0,
    error: c.status === "uploaded" ? null : "this upload didn’t finish.",
    canRetry: false,
    size: 0,
  }));
}

/**
 * The order to upload newly picked clips in: the smallest first (so one is done quickly and people
 * can move on), then the biggest, so the slowest isn't left until last.
 */
function uploadOrder(added: Item[]): string[] {
  if (added.length < 3) return added.map((a) => a.key);
  const bySize = [...added].sort((a, b) => b.size - a.size);
  const smallest = bySize.pop()!;
  return [smallest, ...bySize].map((a) => a.key);
}

// ---- One engine per project, for this tab.

const engines = new Map<string, UploadEngine>();

/**
 * The project's engine (always the same one in this tab): as it is while uploads run or clips picked
 * here are listed (they keep going between pages), else started over from the server's list.
 * (On the server: always a fresh one, never shared.)
 */
export function uploadEngine(projectId: string, initialClips: InitialClip[]): UploadEngine {
  if (typeof window === "undefined") return new UploadEngine(projectId, initialClips);
  const running = engines.get(projectId);
  if (running) {
    if (!running.items.some((i) => inFlight(i.status) || i.key.startsWith("local-"))) running.reset(initialClips);
    return running;
  }
  const engine = new UploadEngine(projectId, initialClips);
  engines.set(projectId, engine);
  watchUnload();
  return engine;
}

/** The project's running engine, if any (another page showing or waiting for the uploads). */
export function runningEngine(projectId: string): UploadEngine | null {
  return typeof window === "undefined" ? null : (engines.get(projectId) ?? null);
}

/** Overall progress of a project's uploads: how many are left, and percent of all the bytes. */
export function uploadProgress(items: Item[]) {
  const live = items.filter((i) => i.key.startsWith("local-") && i.status !== "failed");
  const left = live.filter((i) => inFlight(i.status)).length;
  const total = live.reduce((t, i) => t + (i.size || 1), 0);
  const sent = live.reduce(
    (t, i) => t + (i.size || 1) * (i.status === "uploaded" || i.status === "verifying" ? 1 : i.status === "uploading" ? i.percent / 100 : 0),
    0,
  );
  return {
    left,
    total: live.length,
    percent: total ? Math.min(99, Math.round((100 * sent) / total)) : 100,
    failed: items.filter((i) => i.status === "failed" && i.canRetry).length,
  };
}

/**
 * Waits for a project's uploads to finish (resolves at once if none are running). Resolves with how
 * many failed, so the page can say so instead of starting without them.
 */
export function waitForUploads(projectId: string, onProgress?: (p: ReturnType<typeof uploadProgress>) => void) {
  const engine = runningEngine(projectId);
  return new Promise<{ failed: number }>((resolve) => {
    if (!engine || !engine.busy) return resolve({ failed: engine ? uploadProgress(engine.items).failed : 0 });
    const check = () => {
      const p = uploadProgress(engine.items);
      onProgress?.(p);
      if (!engine.busy) {
        stop();
        resolve({ failed: p.failed });
      }
    };
    const stop = engine.subscribe(check);
    check();
  });
}

let watching = false;
/** Leaving the site (closing the tab, a full reload) while clips upload: the browser asks first. */
function watchUnload() {
  if (watching) return;
  watching = true;
  window.addEventListener("beforeunload", (e) => {
    if ([...engines.values()].some((en) => en.busy)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
