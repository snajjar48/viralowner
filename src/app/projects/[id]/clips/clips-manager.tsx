"use client";

import type React from "react";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ClipThumb } from "@/components/clip-thumb";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { DropZone } from "@/components/drop-zone";
import { buttonClass } from "@/components/form";
import { AlertIcon, CameraIcon, FilmIcon, GripIcon, RefreshIcon, XIcon } from "@/components/icons";
import { ProgressBar } from "@/components/progress-bar";
import { ROLE_LABELS, ShotList } from "@/components/shot-list";
import type { Shot } from "@/lib/processing/types";
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
  inApp,
  isNativeClip,
  pickNativeClips,
  releaseNativeClip,
  uploadNativeClip,
  type NativeClip,
} from "@/lib/native-app";
import { planShrink, shrinkClip, worthShrinking, type ShrinkPlan } from "@/lib/shrink-clip";
import { checkClip, MAX_CLIPS, VIDEO_ACCEPT } from "@/lib/video-files";

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

type ItemStatus = "queued" | "shrinking" | "fetching" | "uploading" | "verifying" | "uploaded" | "failed";
interface Item {
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
}

// Clips uploading at once. Big clips upload several parts at once too (uploadInParts).
const CONCURRENCY = 3;
type SignedPut = { url: string; headers: Record<string, string> };
const noSubscribe = () => () => {};
const inFlight = (s: ItemStatus) =>
  s === "queued" || s === "shrinking" || s === "fetching" || s === "uploading" || s === "verifying";

export function ClipsManager({
  projectId,
  oneTake: takeMode = false,
  freeform = false,
  onStatus,
  shots,
  initialClips,
  rightsConfirmed,
  extra,
}: {
  projectId: string;
  /** Shown under the clips (the optional audio file). */
  extra?: React.ReactNode;
  /** The inspo is one take with the pauses cut out: no shot list, just the take(s). */
  oneTake?: boolean;
  /**
   * "Start from scratch": just the clips, no shot list. The page around it has the consent and
   * the button, and hears how the uploads are going through `onStatus`.
   */
  freeform?: boolean;
  onStatus?: (status: { uploaded: number; busy: boolean }) => void;
  shots: Shot[];
  initialClips: InitialClip[];
  rightsConfirmed: boolean;
}) {
  const oneTake = takeMode || freeform; // neither has shots to assign clips to
  const router = useRouter();
  const dndId = useId(); // stable ids for dnd-kit's accessibility attributes (avoids a hydration mismatch)
  const [items, setItems] = useState<Item[]>(() =>
    initialClips.map((c) => ({
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
    })),
  );
  const [skipped, setSkipped] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(rightsConfirmed);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState("");
  // Inside the viralowner app (its own Photos picker uploads the original files).
  const app = useSyncExternalStore(noSubscribe, inApp, () => false);

  // The picked files. In the viralowner app, the app keeps the video and this is a stand-in for it.
  const files = useRef(new Map<string, File | NativeClip>());
  // Each clip's still is saved next to it once both the still and its upload URL are ready.
  const thumbs = useRef(new Map<string, Blob>());
  const thumbTargets = useRef(new Map<string, SignedPut>());
  const aborts = useRef(new Map<string, AbortController>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  // Big vertical clips that could be made smaller first, on a slow connection (lib/shrink-clip.ts).
  const plans = useRef(new Map<string, ShrinkPlan>());
  const planning = useRef(new Map<string, Promise<ShrinkPlan | null>>());
  // Uploads sending bytes right now (their progress measures this device's upload speed).
  const sending = useRef(0);
  // One clip is shrunk at a time (each takes the phone's video encoder).
  const shrinking = useRef<Promise<unknown>>(Promise.resolve());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    const controllers = aborts.current;
    return () => controllers.forEach((c) => c.abort());
  }, []);

  const patch = (key: string, change: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...change } : it)));

  /**
   * On a slow connection, a big vertical clip is made smaller before it uploads, when that's
   * quicker overall (lib/shrink-clip.ts). Returns the file to upload: the smaller one, or the
   * original whenever shrinking isn't worth it or doesn't work.
   */
  async function maybeShrink(key: string, file: File, signal: AbortSignal): Promise<File> {
    const plan = plans.current.get(key);
    if (!plan) return file;
    // No speed measured yet: while other clips upload, wait a few seconds for one.
    for (let waited = 0; !uploadSpeed() && sending.current > 0 && waited < 12; waited++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (signal.aborted) return file;
    }
    const speed = uploadSpeed();
    if (!speed || !worthShrinking(file, plan, speed)) return file;
    let release = () => {};
    const turn = shrinking.current;
    shrinking.current = new Promise<void>((r) => (release = r));
    try {
      await turn;
      if (signal.aborted) return file;
      patch(key, { status: "shrinking", percent: 0 });
      const smaller = await shrinkClip(file, plan, speed, (percent) => patch(key, { percent }), signal);
      plans.current.delete(key);
      files.current.set(key, smaller); // (a retry uploads the smaller one too)
      return smaller;
    } catch {
      plans.current.delete(key);
      return file;
    } finally {
      release();
    }
  }

  async function uploadOne(key: string) {
    let file = files.current.get(key);
    const item = itemsRef.current.find((i) => i.key === key);
    if (!file || !item) return;
    const controller = new AbortController();
    aborts.current.set(key, controller);
    let counted = false;
    try {
      // Whether it could be made smaller (worked out when it was picked; never waited on for long).
      const pending = planning.current.get(key);
      if (pending) {
        planning.current.delete(key);
        const plan = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
        if (plan) plans.current.set(key, plan);
      }
      // Nothing has measured the upload speed yet: this one goes as is and measures it for the rest.
      if (plans.current.has(key) && !uploadSpeed() && sending.current === 0) plans.current.delete(key);
      if (!plans.current.has(key)) {
        sending.current++;
        counted = true;
      }
      if (!isNativeClip(file)) file = await maybeShrink(key, file, controller.signal);
      if (controller.signal.aborted) return;
      if (!counted) {
        sending.current++;
        counted = true;
      }
      patch(key, { status: "uploading", percent: 0, error: null });
      const { clip, upload, multipart, thumb } = await postJson<{
        clip: { id: string };
        upload: SignedPut;
        multipart: { uploadId: string; partBytes: number; urls: string[] } | null;
        thumb: SignedPut;
      }>(`/api/projects/${projectId}/clips`, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        durationS: item.durationS,
      });
      patch(key, { clipId: clip.id });
      thumbTargets.current.set(key, thumb);
      saveThumb(key);
      const onProgress = (percent: number) => patch(key, { percent });
      let uploadId: string | undefined;
      if (isNativeClip(file)) {
        // In the app: the app sends the original file in one go (it uploads in the background too).
        await uploadNativeClip(
          file,
          upload,
          (percent, phase) => patch(key, { percent, status: phase === "preparing" ? "fetching" : "uploading" }),
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
      patch(key, { status: "verifying" });
      // Without a still made here, the server has one made from the uploaded file.
      const hasThumb = () => !!itemsRef.current.find((i) => i.key === key)?.thumbUrl || thumbs.current.has(key);
      const complete = (id?: string) =>
        postJson<{ clip: { durationS: number }; thumbUrl?: string }>(
          `/api/projects/${projectId}/clips/${clip.id}/complete`,
          { ...(id ? { uploadId: id } : {}), hasThumb: hasThumb() },
        );
      let done;
      try {
        done = await complete(uploadId);
      } catch (e) {
        if (!uploadId) throw e;
        // The parts couldn't be joined: send it in one go instead.
        patch(key, { status: "uploading", percent: 0 });
        await uploadToSignedUrl(file as File, upload, onProgress, controller.signal);
        patch(key, { status: "verifying" });
        done = await complete();
      }
      patch(key, { status: "uploaded", percent: 100, durationS: done.clip.durationS });
      if (isNativeClip(file)) {
        releaseNativeClip(file); // the app's copy isn't needed any more
        files.current.delete(key);
      }
      if (!hasThumb() && done.thumbUrl) void waitForThumb(key, done.thumbUrl);
    } catch (e) {
      if (controller.signal.aborted) return; // removed by the user
      patch(key, {
        status: "failed",
        error: e instanceof UploadError ? e.message : "the upload didn’t go through.",
      });
    } finally {
      if (counted) sending.current--;
      aborts.current.delete(key);
    }
  }

  /** Saves a clip's still to storage once both it and the clip's upload URL are ready (best effort). */
  function saveThumb(key: string) {
    const blob = thumbs.current.get(key);
    const target = thumbTargets.current.get(key);
    if (!blob || !target) return;
    thumbs.current.delete(key);
    void fetch(target.url, { method: "PUT", headers: target.headers, body: blob }).catch(() => {});
  }

  /** Makes stills for newly picked clips, one at a time (each decodes a bit of video). */
  async function makeThumbs(keys: string[]) {
    const missed: string[] = [];
    const make = async (key: string, timeoutMs: number) => {
      const file = files.current.get(key);
      if (!file || isNativeClip(file)) return true; // the app's clips get their still from the server
      const blob = await makeVideoThumbnail(file, 360, timeoutMs);
      if (!blob || !files.current.has(key)) return false;
      thumbs.current.set(key, blob);
      patch(key, { thumbUrl: URL.createObjectURL(blob) });
      saveThumb(key);
      return true;
    };
    for (const key of keys) if (!(await make(key, 8_000))) missed.push(key);
    // A second try for any that didn't work (the first often loses out to everything starting at once).
    for (const key of missed) await make(key, 15_000);
  }

  /** Shows the still the server is making once it's ready (checks every couple of seconds for a while). */
  async function waitForThumb(key: string, url: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, attempt ? 2500 : 1500));
      if (!itemsRef.current.some((i) => i.key === key) || itemsRef.current.find((i) => i.key === key)?.thumbUrl) return;
      const ok = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url; // (a signed link: adding anything to it would break the signature)
      });
      if (ok) return patch(key, { thumbUrl: url });
    }
  }

  function pump() {
    while (active.current < CONCURRENCY && queue.current.length) {
      const key = queue.current.shift()!;
      active.current++;
      void uploadOne(key).finally(() => {
        active.current--;
        pump();
      });
    }
  }

  async function addFiles(picked: (File | NativeClip)[]) {
    const room = MAX_CLIPS - itemsRef.current.filter((i) => i.status !== "failed").length;
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
      files.current.set(key, file);
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
      });
    }
    setSkipped(problems);
    if (!added.length) return;
    setItems((list) => [...list, ...added]);
    itemsRef.current = [...itemsRef.current, ...added];
    // Big vertical clips: could they be made smaller (only used on a slow connection)?
    for (const a of added) {
      const f = files.current.get(a.key);
      if (f && !isNativeClip(f) && f.size > 40 * 1024 * 1024) planning.current.set(a.key, planShrink(f));
    }
    queue.current.push(...added.map((a) => a.key));
    pump();
    void makeThumbs(added.map((a) => a.key));
  }

  /** In the viralowner app: its own Photos picker, which hands over the original files. */
  async function pickInApp() {
    const room = MAX_CLIPS - itemsRef.current.filter((i) => i.status !== "failed").length;
    if (room <= 0) return setSkipped([`you can add up to ${MAX_CLIPS} clips.`]);
    try {
      const picked = await pickNativeClips(room);
      if (picked.length) await addFiles(picked);
    } catch {
      setSkipped(["we couldn’t open your photos. check viralowner is allowed to use them in settings, then try again."]);
    }
  }

  async function retry(item: Item) {
    if (item.clipId) {
      // Start fresh: the failed clip row and any partial file go away.
      void fetch(`/api/projects/${projectId}/clips/${item.clipId}`, { method: "DELETE" });
    }
    patch(item.key, { clipId: null, status: "queued", percent: 0, error: null });
    queue.current.push(item.key);
    pump();
  }

  async function remove(item: Item) {
    aborts.current.get(item.key)?.abort();
    queue.current = queue.current.filter((k) => k !== item.key);
    setItems((list) => list.filter((i) => i.key !== item.key));
    if (selected === item.key) setSelected(null);
    if (item.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    if (item.thumbUrl?.startsWith("blob:")) URL.revokeObjectURL(item.thumbUrl);
    const picked = files.current.get(item.key);
    if (isNativeClip(picked)) releaseNativeClip(picked);
    files.current.delete(item.key);
    thumbs.current.delete(item.key);
    thumbTargets.current.delete(item.key);
    if (item.clipId) {
      const res = await fetch(`/api/projects/${projectId}/clips/${item.clipId}`, { method: "DELETE" }).catch(() => null);
      if (!res?.ok && res?.status !== 404) setError("couldn’t remove that clip. refresh and try again.");
    }
  }

  /** Puts a clip on a shot, or takes it off. One clip can fill several shots (a different part of it each). */
  async function assign(item: Item, shotIndex: number, on: boolean) {
    if (!item.clipId || item.status !== "uploaded") return;
    const before = items;
    setItems((list) =>
      list.map((i) =>
        i.key === item.key
          ? {
              ...i,
              shotIndexes: on
                ? [...new Set([...i.shotIndexes, shotIndex])].sort((a, b) => a - b)
                : i.shotIndexes.filter((s) => s !== shotIndex),
            }
          : on
            ? { ...i, shotIndexes: i.shotIndexes.filter((s) => s !== shotIndex) }
            : i,
      ),
    );
    try {
      await postJsonPatch(`/api/projects/${projectId}/clips`, { assign: { clipId: item.clipId, shotIndex, on } });
    } catch {
      setItems(before);
      setError("couldn’t save that. check your connection and try again.");
    }
  }

  /** "Start from scratch": cut this clip into several shots. */
  async function setMultiUse(item: Item, on: boolean) {
    if (!item.clipId) return;
    setItems((list) => list.map((i) => (i.key === item.key ? { ...i, multiUse: on } : i)));
    try {
      await postJsonPatch(`/api/projects/${projectId}/clips`, { multiUse: { clipId: item.clipId, on } });
    } catch {
      setItems((list) => list.map((i) => (i.key === item.key ? { ...i, multiUse: !on } : i)));
      setError("couldn’t save that. check your connection and try again.");
    }
  }

  function onShotTap(shotIndex: number) {
    const item = items.find((i) => i.key === selected);
    if (!item) {
      setError("tap a clip first, then tap the shot it’s for.");
      return;
    }
    setError("");
    // The clip stays picked, so a long clip can be put on several shots in a row.
    void assign(item, shotIndex, !item.shotIndexes.includes(shotIndex));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active: a, over }: DragEndEvent) {
    if (!over || a.id === over.id) return;
    const from = items.findIndex((i) => i.key === a.id);
    const to = items.findIndex((i) => i.key === over.id);
    const next = arrayMove(items, from, to);
    setItems(next);
    const order = next.map((i) => i.clipId).filter((id): id is string => !!id);
    postJsonPatch(`/api/projects/${projectId}/clips`, { order }).catch(() =>
      setError("couldn’t save the new order. check your connection and try again."),
    );
  }

  async function onContinue() {
    setContinuing(true);
    setError("");
    try {
      await postJson(`/api/projects/${projectId}/clips/confirm`, { rightsConfirmed: true });
      router.push(`/projects/${projectId}/options`);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "something went wrong. please try again.");
      setContinuing(false);
    }
  }

  const uploaded = items.filter((i) => i.status === "uploaded");
  const busy = items.some((i) => inFlight(i.status));
  useEffect(() => {
    onStatus?.({ uploaded: uploaded.length, busy });
  }, [onStatus, uploaded.length, busy]);
  const covered = new Set(uploaded.flatMap((i) => i.shotIndexes));
  const missing = shots.length - covered.size;
  const selectedItem = items.find((i) => i.key === selected) ?? null;

  const checklist = (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted" aria-live="polite">
        {selectedItem
          ? `now tap the shot for ${selectedItem.fileName}. one long clip can fill several shots: tap each one, and we’ll use a different part of it for each.`
          : "tap a clip, then tap the shot it’s for."}
      </p>
      <ShotList shots={shots} covered={covered} onSelect={onShotTap} selected={selectedItem?.shotIndexes[0] ?? null} compact />
    </div>
  );

  return (
    <div className={`grid gap-6 lg:items-start ${oneTake ? "" : "lg:grid-cols-[1fr_340px]"}`}>
      <div className="flex min-w-0 flex-col gap-5">
        {/* Mobile: collapsible shot list */}
        <details className={`group rounded-2xl border border-white/10 bg-white/[0.03] lg:hidden ${oneTake ? "hidden" : ""}`}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-coral">
            <span>
              shot list · {covered.size} of {shots.length} covered
            </span>
            <span className="text-muted transition group-open:rotate-180" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="px-4 pb-4">{checklist}</div>
        </details>

        <DropZone
          accept={VIDEO_ACCEPT}
          multiple
          onFiles={addFiles}
          onPick={app ? pickInApp : undefined}
          compact={items.length > 0}
          icon={<FilmIcon className="size-5" />}
          title={
            freeform
              ? items.length
                ? "add more clips"
                : "upload your clips"
              : oneTake
                ? items.length
                  ? "add another clip"
                  : "upload your take"
                : items.length
                  ? "add more clips"
                  : "upload your clips"
          }
          hint={
            <>
              <span className="sm:hidden">tap to choose from your camera roll.</span>
              <span className="hidden sm:inline">drag them here, or click to choose.</span> up to {MAX_CLIPS} clips,
              MP4 or MOV.
            </>
          }
        />

        <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 text-sm font-medium transition hover:bg-white/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-coral sm:hidden">
          <CameraIcon className="size-5" /> film it now
          <input
            type="file"
            accept="video/*"
            capture="environment"
            className="sr-only"
            // Reset on open, not after picking (see DropZone: iOS drops the file).
            onClick={(e) => {
              e.currentTarget.value = "";
            }}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) void addFiles(picked);
            }}
          />
        </label>

        {!oneTake && (
          <p className="text-center text-xs text-pretty text-muted">
            tip: film pours, drizzles and cheese pulls in slo-mo or at 60fps for smooth slow motion.
          </p>
        )}

        {(takeMode || freeform) && (
          <details className="group rounded-xl border border-white/10 px-3 py-2 text-xs text-muted">
            <summary className="cursor-pointer list-none text-center focus-visible:outline-2 focus-visible:outline-coral [&::-webkit-details-marker]:hidden">
              tips for filming yourself talking <span aria-hidden="true" className="inline-block transition group-open:rotate-180">▾</span>
            </summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-pretty">
              <li>start talking the second you hit record. no “hi guys”: we cut everything before your first word.</li>
              <li>light in front of you (face a window), not behind you. phone at eye level, close enough to hear you clearly.</li>
              <li>film a new clip for each sentence or point, and switch spots or angles between them. it keeps people watching.</li>
              <li>don’t worry about ums, pauses or retakes. we cut them.</li>
            </ul>
          </details>
        )}

        {skipped.length > 0 && (
          <div role="alert" className="flex flex-col gap-1 rounded-xl border border-coral/30 bg-coral/[0.06] p-3 text-sm">
            {skipped.map((s) => (
              <p key={s} className="flex items-start gap-2">
                <AlertIcon className="mt-0.5 size-4 shrink-0 text-coral" /> {s}
              </p>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-center text-sm text-muted">
            {freeform
              ? "no clips yet. add everything you filmed for this video, in any order. we watch all of it."
              : oneTake
                ? "no take yet. film yourself saying your version in one go, then add it here."
                : "no clips yet. film one clip for each shot in your shot list, then add them here."}
          </p>
        ) : (
          <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.key)} strategy={rectSortingStrategy}>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="your clips">
                {items.map((item, index) => (
                  <ClipTile
                    key={item.key}
                    item={item}
                    index={index}
                    shots={shots}
                    oneTake={oneTake}
                    selected={selected === item.key}
                    onSelect={() => setSelected(selected === item.key ? null : item.key)}
                    onRemove={() => remove(item)}
                    onRetry={() => retry(item)}
                    onAssign={(s, on) => assign(item, s, on)}
                    freeform={freeform}
                    onMultiUse={(on) => setMultiUse(item, on)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {extra}

        {!freeform && (
          <ConsentCheckbox checked={confirmed} onChange={setConfirmed}>
            i own or have permission to use these clips and the people in them.
          </ConsentCheckbox>
        )}

        {takeMode && uploaded.length > 1 && (
          <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-muted">
            your clips play in this order. drag to change it.
          </p>
        )}
        {!oneTake && uploaded.length > 0 && missing > 0 && !busy && (
          <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-muted">
            {missing === 1 ? "1 shot doesn’t" : `${missing} shots don’t`} have a clip yet. we’ll make it work, or you can
            add more.
          </p>
        )}
        {busy && <p className="text-center text-sm text-muted">hang tight while your clips finish uploading.</p>}
        {error && (
          <p role="alert" className="text-center text-sm text-coral">
            {error}
          </p>
        )}

        {!freeform && (
          <button
            type="button"
            onClick={onContinue}
            disabled={!uploaded.length || !confirmed || busy || continuing}
            className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none`}
          >
            {continuing ? "saving…" : "continue to options"}
          </button>
        )}
      </div>

      {/* Desktop: sticky checklist */}
      <aside aria-label="shot list" className={`sticky top-6 hidden flex-col gap-3 ${oneTake ? "" : "lg:flex"}`}>
        <h2 className="text-lg font-medium">
          shot list <span className="text-sm font-normal text-muted">· {covered.size} of {shots.length} covered</span>
        </h2>
        {checklist}
      </aside>
    </div>
  );
}

async function postJsonPatch(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("save failed");
}

function ClipTile({
  item,
  index,
  shots,
  oneTake,
  selected,
  onSelect,
  onRemove,
  onRetry,
  onAssign,
  freeform,
  onMultiUse,
}: {
  item: Item;
  index: number;
  shots: Shot[];
  oneTake: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onAssign: (shotIndex: number, on: boolean) => void;
  freeform: boolean;
  onMultiUse: (on: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  });
  const ready = item.status === "uploaded";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex flex-col gap-2 rounded-2xl border p-2 transition ${
        selected ? "border-coral bg-coral/10" : "border-white/10 bg-white/[0.03]"
      } ${isDragging ? "z-10 opacity-80 shadow-2xl" : ""}`}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={!ready || oneTake}
        aria-pressed={selected}
        aria-label={`clip ${index + 1}, ${item.fileName}${ready && !oneTake ? ". tap to assign it to a shot" : ""}`}
        className="relative block cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-default"
      >
        <ClipThumb src={item.previewUrl} image={item.thumbUrl} durationS={item.durationS} label="" />
        <span className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-black/70 text-xs">
          {index + 1}
        </span>
        {item.shotIndexes.length > 0 && ready && (
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-linear-to-r from-violet to-coral px-1.5 py-0.5 text-xs font-medium text-white">
            {item.shotIndexes.length > 1 ? "shots" : "shot"} {item.shotIndexes.map((s) => s + 1).join(", ")}
          </span>
        )}
        {item.status !== "uploaded" && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/65 p-3 text-center text-xs">
            {item.status === "failed" ? (
              <>
                <AlertIcon className="size-5 text-coral" />
                <span>{item.error}</span>
              </>
            ) : (
              <ProgressBar
                value={item.status === "verifying" ? 100 : item.percent}
                label={
                  item.status === "queued"
                    ? "waiting…"
                    : item.status === "shrinking"
                      ? "making it quicker to upload…"
                      : item.status === "fetching"
                        ? "getting it from your photos…"
                      : item.status === "verifying"
                        ? "checking…"
                        : "uploading"
                }
              />
            )}
          </span>
        )}
      </button>

      {ready && !oneTake && <ShotPicker item={item} index={index} shots={shots} onAssign={onAssign} />}

      {ready && freeform && (item.durationS ?? 0) >= 3 && (
        <label className="flex cursor-pointer items-start gap-2 px-0.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={item.multiUse}
            onChange={(e) => onMultiUse(e.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-coral"
          />
          <span>use different parts of this clip in several shots</span>
        </label>
      )}

      {ready && !oneTake && <ShortClipNote item={item} shots={shots} />}

      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`drag to reorder clip ${index + 1}`}
          className="flex size-9 touch-none cursor-grab items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral active:cursor-grabbing"
        >
          <GripIcon className="size-5" />
        </button>
        {item.status === "failed" && item.canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral"
          >
            <RefreshIcon className="size-4" /> retry
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`remove clip ${index + 1}`}
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-coral focus-visible:outline-2 focus-visible:outline-coral"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </li>
  );
}

/**
 * Which shots a clip fills: a small menu of shots to tick (one long clip can fill several, with a
 * different part of it in each).
 */
function ShotPicker({
  item,
  index,
  shots,
  onAssign,
}: {
  item: Item;
  index: number;
  shots: Shot[];
  onAssign: (shotIndex: number, on: boolean) => void;
}) {
  const label = item.shotIndexes.length
    ? `${item.shotIndexes.length > 1 ? "shots" : "shot"} ${item.shotIndexes.map((s) => s + 1).join(", ")}`
    : "no shot yet";
  return (
    <details className="group relative">
      <summary
        aria-label={`shots for clip ${index + 1}: ${label}`}
        className="flex h-9 cursor-pointer list-none items-center justify-between gap-1 rounded-lg border border-white/15 bg-[#15151b] px-2 text-xs focus-visible:outline-2 focus-visible:outline-coral [&::-webkit-details-marker]:hidden"
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true" className="text-muted transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <fieldset className="absolute inset-x-0 top-full z-20 mt-1 flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-xl border border-white/10 bg-[#17171d] p-1.5 shadow-xl shadow-black/50">
        <legend className="sr-only">shots for clip {index + 1}</legend>
        <p className="px-1.5 pt-1 pb-1.5 text-[11px] leading-snug text-muted">
          pick one or more. each shot gets a different part of this clip.
        </p>
        {shots.map((s) => (
          <label
            key={s.index}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs hover:bg-white/[0.06]"
          >
            <input
              type="checkbox"
              checked={item.shotIndexes.includes(s.index)}
              onChange={(e) => onAssign(s.index, e.target.checked)}
              className="size-3.5 shrink-0 accent-coral"
            />
            <span className="truncate">
              shot {s.index + 1}: {ROLE_LABELS[s.role]}
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}

/**
 * A clip shorter than the shot(s) it's on makes them shorter than the inspo's: say so before the
 * render. On several shots, they share the clip (each gets its own part, never the same footage).
 */
function ShortClipNote({ item, shots }: { item: Item; shots: Shot[] }) {
  const on = shots.filter((s) => item.shotIndexes.includes(s.index));
  const need = on.reduce((t, s) => t + s.durationS, 0);
  if (!on.length || item.durationS === null || item.durationS >= need - 0.3) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-300/90">
      <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {on.length === 1
          ? `this clip is ${item.durationS.toFixed(1)}s but shot ${on[0].index + 1} is ${on[0].durationS.toFixed(1)}s, so that shot will be a little shorter. a longer clip matches the original better.`
          : `this clip is ${item.durationS.toFixed(1)}s but shots ${on.map((s) => s.index + 1).join(", ")} need ${need.toFixed(1)}s together. we never repeat footage, so some of them will be shorter.`}
      </span>
    </p>
  );
}
