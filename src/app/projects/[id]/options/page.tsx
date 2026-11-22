import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { getInspiration, listClips } from "@/lib/projects";
import { clipThumbUrl } from "@/lib/clips";
import { createDownloadUrl } from "@/lib/storage";
import { isOneTake, type InspoStyle, type TextStyle } from "@/lib/processing/types";
import { TEXT_ITEMS_MAX, type OptionTextItem } from "@/lib/video-options";
import { OptionsForm } from "./options-form";

export const metadata: Metadata = {
  title: "options",
  robots: { index: false, follow: false },
};

// Step 3: optional extras (smart defaults), then "make my video".
export default function OptionsPage({ params }: PageProps<"/projects/[id]/options">) {
  return (
    <Suspense
      fallback={
        <FlowShell step={3}>
          <PageSkeleton />
        </FlowShell>
      }
    >
      {params.then(({ id }) => (
        <Options id={id} />
      ))}
    </Suspense>
  );
}

async function Options({ id }: { id: string }) {
  const { userId, project } = await loadProject(id, `/projects/${id}/options`);
  if (project.kind === "scratch") redirect(`/projects/${id}/create`); // "start from scratch" has no inspo steps
  const [inspo, clips] = await Promise.all([getInspiration(userId, id), listClips(userId, id)]);
  if (!inspo?.breakdown) redirect(`/projects/${id}/breakdown`);
  const uploaded = clips.filter((c) => c.status === "uploaded");
  // Clips can still be uploading from the clips step (this page waits for them before making).
  if (!project.clipsRightsConfirmedAt) redirect(`/projects/${id}/clips`);

  const optionClips = await Promise.all(
    uploaded.map(async (c) => ({
      id: c.id,
      fileName: c.fileName,
      durationS: c.durationS,
      shotIndexes: c.shotIndexes,
      previewUrl: await createDownloadUrl(c.storageKey, { expiresIn: 6 * 3600 }),
      thumbUrl: await clipThumbUrl(c.storageKey),
    })),
  );

  // The original's on-screen text as pieces (a run of shots showing the same words is one piece), at
  // its height on screen: "write my own" can start from it.
  const style = inspo.breakdown.style;
  const blocks = style?.textTimeline?.some((b) => b.letterHeight) ? style.textTimeline : null;
  const originalText: OptionTextItem[] = blocks ? originalBlocks(blocks, style!.text) : [];
  if (!blocks) inspo.breakdown.shots.forEach((shot, i) => {
    const text = (style?.textLines?.[i] ?? shot.onScreenText ?? "").trim();
    if (!text) return;
    const last = originalText.at(-1);
    if (last && last.text === text && last.shots?.at(-1) === i - 1) return void last.shots.push(i);
    const y = style?.textSpots?.[i]?.[1];
    originalText.push({ text, shots: [i], ...(typeof y === "number" ? { y: Math.round(Math.min(0.72, Math.max(0.14, y)) * 1000) / 1000 } : {}) });
  });

  return (
    <FlowShell step={3} projectId={id}>
      <PageTitle title="final touches" subtitle="all optional. the defaults work great, so you can go straight to the button." />
      <OptionsForm
        projectId={id}
        initialOptions={
          // Until the user picks, captions start in the style closest to the inspo's own.
          !project.settingsSaved && inspo.breakdown.style?.captions?.look
            ? { ...project.settings, captions: { ...project.settings.captions, enabled: true, style: inspo.breakdown.style.captions.look } }
            : project.settings
        }
        shots={inspo.breakdown.shots}
        clips={optionClips}
        oneTake={isOneTake(inspo.breakdown)}
        originalText={originalText.slice(0, TEXT_ITEMS_MAX)}
        uploadedAudio={project.audio?.status === "uploaded" ? { fileName: project.audio.fileName } : null}
      />
    </FlowShell>
  );
}

const LETTER = { small: 0.028, medium: 0.038, large: 0.052, xl: 0.075 };

/**
 * The original's text blocks (a location, a title, a price, small print...), each with its own time,
 * place, size and color. A layout running into TikTok's buttons is squeezed into the safe area, every
 * block keeping its place relative to the others (as the worker does).
 */
function originalBlocks(blocks: NonNullable<InspoStyle["textTimeline"]>, text: TextStyle): OptionTextItem[] {
  const base = text.letterHeight ?? LETTER[text.size] ?? LETTER.large;
  const r = (v: number, k = 1000) => Math.round(v * k) / k;
  const [lo, hi] = [0.145, 0.73];
  const ys = blocks.map((b) => b.y);
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const [a, b] = [Math.min(y0, lo), Math.max(y1, hi)];
  const k = (hi - lo) / Math.max(1e-6, b - a);
  return blocks.map((bl) => {
    const align = bl.align === "left" || bl.align === "right" ? bl.align : "center";
    const size = bl.letterHeight ? Math.min(3, Math.max(0.25, (bl.letterHeight / base) * (k < 0.95 ? Math.max(0.75, k) : 1))) : 1;
    return {
      text: bl.text,
      start: r(bl.start, 100),
      end: r(bl.end, 100),
      y: r(lo + (bl.y - a) * k),
      align,
      ...(typeof bl.x === "number" && !(align === "center" && Math.abs(bl.x - 0.5) < 0.08) ? { x: r(bl.x) } : {}),
      size: r(size, 100),
      ...(bl.color ? { color: bl.color } : {}),
      ...(bl.font ? { font: bl.font } : {}),
      ...(bl.look ? { look: bl.look } : {}),
    };
  });
}
