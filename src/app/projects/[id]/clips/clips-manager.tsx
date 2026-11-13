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
import { useEffect, useId, useRef, useState } from "react";
import { ClipThumb } from "@/components/clip-thumb";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { DropZone } from "@/components/drop-zone";
import { buttonClass } from "@/components/form";
import { AlertIcon, CameraIcon, FilmIcon, GripIcon, RefreshIcon, XIcon } from "@/components/icons";
import { ProgressBar } from "@/components/progress-bar";
import { ROLE_LABELS, ShotList } from "@/components/shot-list";
import type { Shot } from "@/lib/processing/types";
import { postJson, readVideoDuration, uploadToSignedUrl, UploadError } from "@/lib/upload-client";
import { checkClip, MAX_CLIPS, VIDEO_ACCEPT } from "@/lib/video-files";

export interface InitialClip {
  id: string;
  fileName: string | null;
  durationS: number | null;
  shotIndex: number | null;
  status: "uploading" | "uploaded" | "failed";
  previewUrl: string | null;
}

type ItemStatus = "queued" | "uploading" | "verifying" | "uploaded" | "failed";
interface Item {
  key: string;
  clipId: string | null;
  fileName: string;
  durationS: number | null;
  previewUrl: string | null;
  shotIndex: number | null;
  status: ItemStatus;
  percent: number;
  error: string | null;
  /** False when the file isn't in this browser any more (e.g. after a refresh). */
  canRetry: boolean;
}

const CONCURRENCY = 3;
const inFlight = (s: ItemStatus) => s === "queued" || s === "uploading" || s === "verifying";

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
      shotIndex: c.shotIndex,
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

  const files = useRef(new Map<string, File>());
  const aborts = useRef(new Map<string, AbortController>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
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

  async function uploadOne(key: string) {
    const file = files.current.get(key);
    const item = itemsRef.current.find((i) => i.key === key);
    if (!file || !item) return;
    const controller = new AbortController();
    aborts.current.set(key, controller);
    patch(key, { status: "uploading", percent: 0, error: null });
    try {
      const { clip, upload } = await postJson<{
        clip: { id: string };
        upload: { url: string; headers: Record<string, string> };
      }>(`/api/projects/${projectId}/clips`, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        durationS: item.durationS,
      });
      patch(key, { clipId: clip.id });
      await uploadToSignedUrl(file, upload, (percent) => patch(key, { percent }), controller.signal);
      patch(key, { status: "verifying" });
      const done = await postJson<{ clip: { durationS: number } }>(
        `/api/projects/${projectId}/clips/${clip.id}/complete`,
      );
      patch(key, { status: "uploaded", percent: 100, durationS: done.clip.durationS });
    } catch (e) {
      if (controller.signal.aborted) return; // removed by the user
      patch(key, {
        status: "failed",
        error: e instanceof UploadError ? e.message : "the upload didn’t go through.",
      });
    } finally {
      aborts.current.delete(key);
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

  async function addFiles(picked: File[]) {
    const room = MAX_CLIPS - itemsRef.current.filter((i) => i.status !== "failed").length;
    const problems: string[] = [];
    if (picked.length > room) {
      problems.push(`you can add up to ${MAX_CLIPS} clips, so we skipped ${picked.length - Math.max(0, room)}.`);
      picked = picked.slice(0, Math.max(0, room));
    }
    const added: Item[] = [];
    for (const file of picked) {
      const durationS = checkClip(file, null) ? null : await readVideoDuration(file);
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
        previewUrl: URL.createObjectURL(file),
        shotIndex: null,
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
    queue.current.push(...added.map((a) => a.key));
    pump();
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
    files.current.delete(item.key);
    if (item.clipId) {
      const res = await fetch(`/api/projects/${projectId}/clips/${item.clipId}`, { method: "DELETE" }).catch(() => null);
      if (!res?.ok && res?.status !== 404) setError("couldn’t remove that clip. refresh and try again.");
    }
  }

  async function assign(item: Item, shotIndex: number | null) {
    if (!item.clipId || item.status !== "uploaded") return;
    setItems((list) =>
      list.map((i) =>
        i.key === item.key ? { ...i, shotIndex } : shotIndex !== null && i.shotIndex === shotIndex ? { ...i, shotIndex: null } : i,
      ),
    );
    try {
      await postJsonPatch(`/api/projects/${projectId}/clips`, { assign: { clipId: item.clipId, shotIndex } });
    } catch {
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
    void assign(item, item.shotIndex === shotIndex ? null : shotIndex);
    setSelected(null);
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
  const covered = new Set(uploaded.map((i) => i.shotIndex).filter((s): s is number => s !== null));
  const missing = shots.length - covered.size;
  const selectedItem = items.find((i) => i.key === selected) ?? null;

  const checklist = (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted" aria-live="polite">
        {selectedItem
          ? `now tap the shot for ${selectedItem.fileName}.`
          : "tap a clip, then tap the shot it’s for."}
      </p>
      <ShotList shots={shots} covered={covered} onSelect={onShotTap} selected={selectedItem?.shotIndex ?? null} compact />
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
              ? "no clips yet. add everything you filmed for this video, in any order. claude watches all of it."
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
                    onAssign={(s) => assign(item, s)}
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
}: {
  item: Item;
  index: number;
  shots: Shot[];
  oneTake: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onAssign: (shotIndex: number | null) => void;
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
        <ClipThumb src={item.previewUrl} durationS={item.durationS} label="" />
        <span className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-black/70 text-xs">
          {index + 1}
        </span>
        {item.shotIndex !== null && ready && (
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-linear-to-r from-violet to-coral px-1.5 py-0.5 text-xs font-medium text-white">
            shot {item.shotIndex + 1}
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
                label={item.status === "queued" ? "waiting…" : item.status === "verifying" ? "checking…" : "uploading"}
              />
            )}
          </span>
        )}
      </button>

      {ready && !oneTake ? (
        <label className="sr-only" htmlFor={`shot-${item.key}`}>
          shot for clip {index + 1}
        </label>
      ) : null}
      {ready && !oneTake && (
        <select
          id={`shot-${item.key}`}
          value={item.shotIndex ?? ""}
          onChange={(e) => onAssign(e.target.value === "" ? null : Number(e.target.value))}
          className="h-9 w-full rounded-lg border border-white/15 bg-[#15151b] px-2 text-xs text-foreground outline-none focus-visible:border-coral"
        >
          <option value="">no shot yet</option>
          {shots.map((s) => (
            <option key={s.index} value={s.index}>
              shot {s.index + 1}: {ROLE_LABELS[s.role]}
            </option>
          ))}
        </select>
      )}

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
