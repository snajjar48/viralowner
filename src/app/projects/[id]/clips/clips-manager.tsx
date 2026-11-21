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
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { ClipThumb } from "@/components/clip-thumb";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { DropZone } from "@/components/drop-zone";
import { buttonClass } from "@/components/form";
import { AlertIcon, CameraIcon, FilmIcon, GripIcon, RefreshIcon, XIcon } from "@/components/icons";
import { ProgressBar } from "@/components/progress-bar";
import { ROLE_LABELS, ShotList } from "@/components/shot-list";
import type { Shot } from "@/lib/processing/types";
import { postJson, UploadError } from "@/lib/upload-client";
import { inApp, pickNativeClips, type NativeClip } from "@/lib/native-app";
import { MAX_CLIPS, VIDEO_ACCEPT } from "@/lib/video-files";
import { UploadTips } from "./upload-tips";
import { inFlight, uploadEngine, uploadProgress, type InitialClip, type Item } from "./upload-engine";

export type { InitialClip } from "./upload-engine";

const noSubscribe = () => () => {};

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
  // The uploads live outside this page (they keep going after "continue").
  const [engine] = useState(() => uploadEngine(projectId, initialClips));
  const items = useSyncExternalStore(engine.subscribe, engine.get, engine.get);
  const setItems = engine.set;
  const [skipped, setSkipped] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(rightsConfirmed);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState("");
  // Inside the viralowner app (its own Photos picker uploads the original files).
  const app = useSyncExternalStore(noSubscribe, inApp, () => false);

  async function addFiles(picked: (File | NativeClip)[]) {
    setSkipped(await engine.addFiles(picked));
  }

  /** In the viralowner app: its own Photos picker, which hands over the original files. */
  async function pickInApp() {
    const room = MAX_CLIPS - engine.items.filter((i) => i.status !== "failed").length;
    if (room <= 0) return setSkipped([`you can add up to ${MAX_CLIPS} clips.`]);
    try {
      const picked = await pickNativeClips(room);
      if (picked.length) await addFiles(picked);
    } catch {
      setSkipped(["we couldn’t open your photos. check viralowner is allowed to use them in settings, then try again."]);
    }
  }

  function retry(item: Item) {
    engine.retry(item);
  }

  async function remove(item: Item) {
    if (selected === item.key) setSelected(null);
    if (!(await engine.remove(item))) setError("couldn’t remove that clip. refresh and try again.");
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
  const progress = uploadProgress(items);
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

        <UploadTips />

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
        {busy && (
          <p className="text-center text-sm text-muted">
            {freeform
              ? "your clips keep uploading while you fill in the rest."
              : uploaded.length
                ? `${progress.left} still uploading (${progress.percent}%). you can continue: they keep uploading on the next step.`
                : "your first clip is almost there…"}
          </p>
        )}
        {error && (
          <p role="alert" className="text-center text-sm text-coral">
            {error}
          </p>
        )}

        {!freeform && (
          <button
            type="button"
            onClick={onContinue}
            disabled={!uploaded.length || !confirmed || continuing}
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
