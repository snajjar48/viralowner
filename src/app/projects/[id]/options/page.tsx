import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageSkeleton, PageTitle } from "@/components/flow-shell";
import { loadProject } from "@/lib/project-page";
import { getInspiration, listClips } from "@/lib/projects";
import { clipThumbUrl } from "@/lib/clips";
import { createDownloadUrl } from "@/lib/storage";
import { isOneTake } from "@/lib/processing/types";
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
  const originalText: OptionTextItem[] = [];
  inspo.breakdown.shots.forEach((shot, i) => {
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
