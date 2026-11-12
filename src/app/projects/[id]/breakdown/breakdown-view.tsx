import Link from "next/link";
import { PageTitle } from "@/components/flow-shell";
import { buttonClass } from "@/components/form";
import { ArrowRightIcon, SparkleIcon } from "@/components/icons";
import { ShotList } from "@/components/shot-list";
import { VideoPlayer } from "@/components/video-player";
import { isOneTake, type Breakdown, type InspoStyle } from "@/lib/processing/types";
import { formatDuration } from "@/lib/video-options";

const TRANSITION_NAMES: Record<string, string> = {
  crossfade: "crossfade",
  dissolve: "dissolve",
  flash: "flash",
  dip_to_black: "fade to black",
  whip: "whip pan",
  whip_left: "whip pan",
  whip_right: "whip pan",
  whip_up: "whip pan",
  whip_down: "whip pan",
  slide: "slide",
  slide_left: "slide",
  slide_right: "slide",
  slide_up: "slide",
  slide_down: "slide",
  zoom: "zoom",
  zoom_in: "zoom",
  zoom_out: "zoom out",
  spin: "spin",
  glitch: "glitch",
  shake: "shake",
  light_leak: "light leak",
  blur: "blur",
  wipe: "wipe",
  wipe_left: "wipe",
  wipe_right: "wipe",
  wipe_up: "wipe",
  wipe_down: "wipe",
  circle_open: "circle reveal",
  pixelate: "pixelate",
};
const EFFECT_NAMES: Record<string, string> = {
  slow_zoom_in: "slow zoom in",
  slow_zoom_out: "slow zoom out",
  punch_in: "punch-in",
  shake: "shake",
  pan_left: "pan",
  pan_right: "pan",
  slow_motion: "slow motion",
  fast: "speed-up",
  freeze_end: "freeze frame",
  zoom_pulse: "zoom pulse",
  flash_in: "flash",
  rgb_split: "rgb split",
  focus_in: "focus pull",
  black_and_white: "black and white",
  grain: "film grain",
  vhs: "vhs look",
  vignette: "vignette",
  letterbox: "letterbox",
  soft_glow: "glow",
};
const SOUND_NAMES: Record<string, string> = {
  whoosh: "whoosh",
  swish: "swish",
  pop: "pop",
  click: "click",
  camera_shutter: "camera shutter",
  ding: "ding",
  cash_register: "cha-ching",
  boom: "boom",
  riser: "riser",
  glitch: "glitch sound",
  record_scratch: "record scratch",
  typing: "typing",
};
const FONT_NAMES: Record<string, string> = {
  clean_sans: "clean sans",
  heavy_sans: "heavy sans",
  condensed: "tall bold",
  tall_caps: "tall capitals",
  serif: "serif",
  typewriter: "typewriter",
  marker: "marker",
  script: "script",
  rounded: "rounded",
};

function countList(values: string[], names: Record<string, string>) {
  const counts = new Map<string, number>();
  for (const v of values) if (names[v]) counts.set(names[v], (counts.get(names[v]) ?? 0) + 1);
  const plural = (name: string) => (/(s|sh|ch|x)$/.test(name) ? `${name}es` : `${name}s`);
  return [...counts].map(([name, n]) => (n > 1 ? `${n} ${plural(name)}` : name)).join(", ");
}

/** What the render will copy from the inspo, in plain words. */
function styleStats(st: InspoStyle) {
  const t = st.text;
  return [
    { label: "transitions", value: countList(st.transitions, TRANSITION_NAMES) || "hard cuts" },
    {
      label: "effects",
      value:
        countList(
          [...st.motions, ...(st.speeds ?? []), ...(st.shotEffects ?? []).flat(), ...(st.looks ?? [])],
          EFFECT_NAMES,
        ) || "none",
    },
    { label: "sound effects", value: countList((st.sfx ?? []).map((x) => x.name), SOUND_NAMES) || "none" },
    { label: "color", value: st.colorFilter === "none" ? "natural" : st.colorFilter.replaceAll("_", " ") },
    {
      label: "text look",
      value: `${FONT_NAMES[t.font] ?? "sans"}, ${t.align}${t.animation !== "none" ? `, ${t.animation.replaceAll("_", " ")} in` : ""}`,
    },
  ];
}

/** The finished breakdown: summary, why it works, and the shot list. */
export function BreakdownView({ projectId, breakdown: b, videoUrl }: { projectId: string; breakdown: Breakdown; videoUrl: string }) {
  const stats = [
    { label: "length", value: formatDuration(b.durationS) },
    { label: "shots", value: String(b.shotCount) },
    { label: "pacing", value: b.pacing.description },
    { label: "text overlays", value: b.textOverlays.present ? (b.textOverlays.style ?? "yes") : "none" },
    { label: "captions", value: b.captionStyle },
  ];

  const oneTake = isOneTake(b);

  return (
    <>
      <PageTitle
        title="here’s how your inspo is built"
        subtitle={
          oneTake
            ? "this one is a single take with the pauses cut out. film yours in one go and we’ll cut it the same way."
            : "film one clip for each shot below. it doesn’t have to be perfect. close enough works great."
        }
      />

      <section aria-label="summary" className="flex gap-4">
        <VideoPlayer src={videoUrl} size="sm" label="your inspo video" className="w-32 sm:w-40" />
        <dl className="grid flex-1 grid-cols-1 content-start gap-2 min-[420px]:grid-cols-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="text-sm font-medium">{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {b.insights && (
        <section
          aria-labelledby="why-heading"
          className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
        >
          <h2 id="why-heading" className="flex items-center gap-2 text-lg font-medium">
            <SparkleIcon className="size-4 text-coral" /> why it works
          </h2>
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">the hook</dt>
              <dd>{b.insights.hook}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">the structure</dt>
              <dd>{b.insights.structure}</dd>
            </div>
            {b.insights.whyItWorks.length > 0 && (
              <div>
                <dt className="text-xs text-muted">why people watch to the end</dt>
                <dd>
                  <ul className="mt-1 flex flex-col gap-1.5">
                    {b.insights.whyItWorks.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-2 size-1.5 shrink-0 rounded-full bg-linear-to-r from-violet to-coral"
                        />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {b.insights.audio && (
              <div>
                <dt className="text-xs text-muted">sound</dt>
                <dd>{b.insights.audio}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {b.style && (
        <section aria-labelledby="style-heading" className="flex flex-col gap-3">
          <h2 id="style-heading" className="text-lg font-medium">
            editing style we’ll copy
          </h2>
          <dl className="grid grid-cols-2 gap-2">
            {styleStats(b.style).map((st) => (
              <div key={st.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <dt className="text-xs text-muted">{st.label}</dt>
                <dd className="text-sm font-medium">{st.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {oneTake ? (
        <section
          aria-labelledby="take-heading"
          className="flex flex-col gap-3 rounded-2xl border border-violet/40 bg-violet/10 p-4 sm:p-5"
        >
          <h2 id="take-heading" className="text-lg font-medium">
            film it in one take
          </h2>
          <p className="text-sm text-muted">
            the inspo looks like {b.shotCount} shots, but it’s really one person talking with every pause, breath and
            “um” cut out{b.style?.alternateZoom ? ", jumping between a normal and a zoomed-in shot" : ""}. you don’t need
            separate clips.
          </p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {[
              "set your phone up at eye level and talk to it, like the inspo.",
              "say your version from start to finish. pause whenever you like.",
              "messed up a line? just say it again. we keep the last good one.",
              "one long clip is perfect. a few clips work too, in order.",
            ].map((tip) => (
              <li key={tip} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-linear-to-r from-violet to-coral" />
                {tip}
              </li>
            ))}
          </ul>
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground">
              see every cut in the inspo
            </summary>
            <div className="pt-3">
              <ShotList shots={b.shots} detailed />
            </div>
          </details>
        </section>
      ) : (
        <section aria-labelledby="shots-heading" className="flex flex-col gap-3">
          <h2 id="shots-heading" className="text-lg font-medium">
            your shot list
          </h2>
          <ShotList shots={b.shots} detailed />
        </section>
      )}

      <div className="sticky bottom-4 flex flex-col gap-3 pt-2">
        <Link href={`/projects/${projectId}/clips`} className={`${buttonClass} flex items-center justify-center gap-2`}>
          {oneTake ? "looks good, upload my take" : "looks good, upload my clips"} <ArrowRightIcon className="size-4" />
        </Link>
      </div>
      <Link
        href={`/projects/${projectId}/inspo`}
        className="self-center text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        use a different inspo
      </Link>
    </>
  );
}
