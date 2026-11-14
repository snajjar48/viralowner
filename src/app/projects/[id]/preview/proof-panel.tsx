"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Section } from "@/components/options-fields";
import type { Proof, ProofMoment } from "@/lib/processing/types";
import { activeRenderIdFrom, postJson, UploadError } from "@/lib/upload-client";
import { formatDuration } from "@/lib/video-options";

type Added = Proof & { preview: string };

/**
 * "Show the proof": the numbers and results said in the video (and screenshots already on it). A
 * screenshot added for one pops in on those words. Remaking with them is free.
 */
export function ProofPanel({
  projectId,
  version,
  moments,
  proofs,
}: {
  projectId: string;
  version: number;
  moments: ProofMoment[];
  proofs: Proof[];
}) {
  const router = useRouter();
  const [kept, setKept] = useState<Proof[]>(proofs);
  const [added, setAdded] = useState<Added[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const all = [...kept, ...added];
  const changed = added.length > 0 || kept.length !== proofs.length;
  const open = moments.filter((m) => !all.some((p) => p.phrase.toLowerCase() === m.phrase.toLowerCase()));
  if (!moments.length && !proofs.length) return null;

  async function upload(phrase: string, file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError("add a PNG, JPG or WebP screenshot.");
    if (file.size > 15 * 1024 * 1024) return setError("screenshots need to be 15 MB or less.");
    setError("");
    setUploading(phrase);
    try {
      const { key, upload } = await postJson<{ key: string; upload: { url: string; headers: Record<string, string> } }>(
        `/api/projects/${projectId}/proofs`,
        { contentType: file.type, sizeBytes: file.size },
      );
      const res = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: file }).catch(() => null);
      if (!res?.ok) throw new UploadError("that screenshot didn’t upload. check your connection and try again.");
      setAdded((list) => [...list, { key, phrase, preview: URL.createObjectURL(file) }]);
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "that screenshot didn’t upload. please try again.");
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const { renderId } = await postJson<{ renderId: string }>(`/api/projects/${projectId}/renders`, {
        mode: "proof",
        fromVersion: version,
        proofs: all.map(({ key, phrase }) => ({ key, phrase })),
      });
      router.push(`/projects/${projectId}/status?render=${renderId}`);
    } catch (e) {
      const activeId = activeRenderIdFrom(e);
      if (activeId) return router.push(`/projects/${projectId}/status?render=${activeId}`);
      setError(e instanceof UploadError ? e.message : "something went wrong. please try again.");
      setBusy(false);
    }
  }

  return (
    <Section title="show the proof" aside={<span className="text-xs text-muted">free</span>}>
      <p className="text-sm text-pretty text-muted">
        the videos that go viral show proof the moment they say a number. add a screenshot and it pops in right on those
        words.
      </p>
      <ul className="flex flex-col gap-2">
        {all.map((p) => (
          <li key={p.key} className="flex items-center gap-3 rounded-xl border border-white/10 p-2.5 text-sm">
            {"preview" in p ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file
              <img src={(p as Added).preview} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300">
                ✓
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">“{p.phrase}”</span>
            <button
              type="button"
              onClick={() => {
                setKept((l) => l.filter((x) => x.key !== p.key));
                setAdded((l) => l.filter((x) => x.key !== p.key));
              }}
              className="h-8 shrink-0 cursor-pointer rounded-full px-3 text-xs text-muted hover:bg-white/10 hover:text-coral focus-visible:outline-2 focus-visible:outline-coral"
            >
              remove
            </button>
          </li>
        ))}
        {open.map((m) => (
          <li key={m.phrase} className="flex items-center gap-3 rounded-xl border border-dashed border-white/15 p-2.5 text-sm">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">
                “{m.phrase}” <span className="text-xs text-muted tabular-nums">at {formatDuration(m.atS)}</span>
              </span>
              {m.ask && <span className="truncate text-xs text-muted">a screenshot of {m.ask}</span>}
            </span>
            <input
              ref={(el) => {
                if (el) inputs.current.set(m.phrase, el);
              }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label={`screenshot for “${m.phrase}”`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(m.phrase, f);
              }}
            />
            <button
              type="button"
              onClick={() => inputs.current.get(m.phrase)?.click()}
              disabled={uploading !== null}
              className="h-9 shrink-0 cursor-pointer rounded-full bg-white/10 px-3.5 text-xs font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-50"
            >
              {uploading === m.phrase ? "uploading…" : "add screenshot"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
      {changed && (
        <button
          type="button"
          onClick={save}
          disabled={busy || uploading !== null}
          className="h-11 cursor-pointer rounded-full bg-white/10 px-5 text-sm font-medium transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "starting…" : all.length ? "add them to my video · free" : "take them off my video · free"}
        </button>
      )}
    </Section>
  );
}
