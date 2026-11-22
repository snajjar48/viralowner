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
  // The same blocks exactly where the original has them ("keep the text exactly where the original has it").
  const originalExact = blocks ? originalBlocks(blocks, style!.text, true).slice(0, TEXT_ITEMS_MAX) : undefined;
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
        originalExact={originalExact}
        uploadedAudio={project.audio?.status === "uploaded" ? { fileName: project.audio.fileName } : null}
      />
    </FlowShell>
  );
}

const LETTER = { small: 0.028, medium: 0.038, large: 0.052, xl: 0.075 };
const SAFE_TOP = 0.125;
const SAFE_BOTTOM = 0.75;

/**
 * The original's text blocks (a location, a title, a price, small print...), each with its own time,
 * place, size and color, laid out as the worker lays them out (fit_blocks_to_safe): a group of blocks
 * under TikTok's buttons moves as one, just clear of them; if that can't work, the layout is squeezed.
 * Sizes are relative to the size preset the video's text is drawn with (as the worker's are).
 */
function originalBlocks(blocks: NonNullable<InspoStyle["textTimeline"]>, text: TextStyle, exact = false): OptionTextItem[] {
  const base = LETTER[text.size] ?? LETTER.large;
  const r = (v: number, k = 1000) => Math.round(v * k) / k;
  const items = blocks.map((bl) => {
    const align: "left" | "center" | "right" = bl.align === "left" || bl.align === "right" ? bl.align : "center";
    const lines = Math.max(1, bl.text.split("\n").filter((l) => l.trim()).length);
    return {
      bl,
      align,
      y: bl.y,
      size: bl.letterHeight ? Math.min(3, Math.max(0.25, bl.letterHeight / base)) : 1,
      h: lines * (bl.letterHeight ?? base) * 1.75,
    };
  });
  const top = (x: (typeof items)[number]) => x.y - x.h / 2;
  const bottom = (x: (typeof items)[number]) => x.y + x.h / 2;
  if (!exact && items.length && (Math.min(...items.map(top)) < SAFE_TOP || Math.max(...items.map(bottom)) > SAFE_BOTTOM)) {
    const order = [...items].sort((a, b) => a.y - b.y);
    const groups = [[order[0]]];
    for (const x of order.slice(1)) {
      const g = groups.at(-1)!;
      if (top(x) - Math.max(...g.map(bottom)) < 0.06) g.push(x);
      else groups.push([x]);
    }
    const shifts = groups.map((g) => {
      const [g0, g1] = [Math.min(...g.map(top)), Math.max(...g.map(bottom))];
      return g0 < SAFE_TOP ? SAFE_TOP - g0 : g1 > SAFE_BOTTOM ? SAFE_BOTTOM - g1 : 0;
    });
    const spans = groups.map((g, i) => [Math.min(...g.map(top)) + shifts[i], Math.max(...g.map(bottom)) + shifts[i]]);
    const fits =
      spans.every(([a, b]) => b - a <= SAFE_BOTTOM - SAFE_TOP + 1e-6) &&
      spans.every((sp, i) => i === spans.length - 1 || sp[1] + 0.01 <= spans[i + 1][0]);
    if (fits) groups.forEach((g, i) => g.forEach((x) => (x.y += shifts[i])));
    else {
      const [y0, y1] = [Math.min(...items.map(top)), Math.max(...items.map(bottom))];
      const [a, b] = [Math.min(y0, SAFE_TOP), Math.max(y1, SAFE_BOTTOM)];
      const k = (SAFE_BOTTOM - SAFE_TOP) / Math.max(1e-6, b - a);
      for (const x of items) {
        x.y = SAFE_TOP + (x.y - a) * k;
        if (k < 0.95) x.size = Math.max(0.25, x.size * Math.max(0.75, k));
      }
    }
  }
  // Listed top to bottom (as they read on screen); same height: the earlier one first.
  items.sort((a, b) => a.y - b.y || a.bl.start - b.bl.start);
  return items.map(({ bl, align, y, size }) => ({
    text: bl.text,
    start: r(bl.start, 100),
    end: r(bl.end, 100),
    y: r(y),
    align,
    ...(typeof bl.x === "number" && !(align === "center" && Math.abs(bl.x - 0.5) < 0.08) ? { x: r(bl.x) } : {}),
    size: r(size, 100),
    ...(bl.color ? { color: bl.color } : {}),
    ...(bl.font ? { font: bl.font } : {}),
    ...(bl.look ? { look: bl.look } : {}),
  }));
}
