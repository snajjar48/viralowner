import Image from "next/image";
import Link from "next/link";
import { compactNumber, PLATFORM_NAMES, platformOf, SHOWCASE, type ShowcaseVideo } from "@/content/showcase";
import { EyeIcon, PlayIcon } from "./icons";
import { SITE_URL } from "./structured-data";

/** One video: its thumbnail with views and likes, linking to the post. */
export function ShowcaseCard({ v, priority = false }: { v: ShowcaseVideo; priority?: boolean }) {
  const platform = PLATFORM_NAMES[platformOf(v.url)];
  return (
    <li className="group flex min-w-0 flex-col gap-3">
      <a
        href={v.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`watch “${v.title}” by ${v.by} on ${platform}: ${compactNumber(v.views)} views, ${compactNumber(v.likes)} likes`}
        className="relative block aspect-[9/16] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition group-hover:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
      >
        <Image
          src={v.thumbnail}
          alt=""
          fill
          priority={priority}
          sizes="(min-width: 1024px) 280px, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition duration-300 group-hover:scale-[1.03]"
        />
        <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/75 via-transparent to-black/25" />
        <span className="absolute top-2.5 left-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
          {platform}
        </span>
        <span className="absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <PlayIcon className="ml-0.5 size-6" />
        </span>
        <span className="absolute inset-x-3 bottom-3 flex items-center gap-3 text-sm font-semibold text-white tabular-nums">
          <span className="flex items-center gap-1">
            <EyeIcon className="size-4" />
            {compactNumber(v.views)}
          </span>
          <span className="flex items-center gap-1">
            <HeartIcon className="size-4" />
            {compactNumber(v.likes)}
          </span>
        </span>
      </a>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <p className="truncate text-sm font-medium">{v.title}</p>
        <p className="truncate text-xs text-muted">
          {v.by} · {countedLabel(v.countedOn)}
        </p>
      </div>
    </li>
  );
}

export function ShowcaseGrid({ videos }: { videos: ShowcaseVideo[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
      {videos.map((v, i) => (
        <ShowcaseCard key={v.url} v={v} priority={i < 4} />
      ))}
    </ul>
  );
}

/** The home page's section: a few videos and a button to the rest. Nothing while there are none. */
export function ShowcaseSection({ videos }: { videos: ShowcaseVideo[] }) {
  if (!videos.length) return null;
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex max-w-2xl flex-col gap-3">
            <p className="text-sm font-medium bg-linear-to-r from-violet to-coral bg-clip-text text-transparent">
              made with viralowner
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">real businesses, real views.</h2>
            <p className="text-pretty text-muted sm:text-lg">videos people made with their own clips and posted. tap one to watch it.</p>
          </div>
          {SHOWCASE.length > videos.length && <AllVideosLink className="hidden sm:inline-flex" />}
        </div>
        <ShowcaseGrid videos={videos} />
        {SHOWCASE.length > videos.length && <AllVideosLink className="self-start sm:hidden" />}
      </div>
    </section>
  );
}

function AllVideosLink({ className }: { className: string }) {
  return (
    <Link
      href="/made-with-viralowner"
      className={`h-11 shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 text-sm font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral inline-flex ${className}`}
    >
      see all {SHOWCASE.length} videos <span aria-hidden="true">→</span>
    </Link>
  );
}

/** The videos as structured data (VideoObject needs a date, so only ones with `postedOn`). */
export function showcaseSchema(videos: ShowcaseVideo[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: videos.map((v, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: v.url,
      ...(v.postedOn
        ? {
            item: {
              "@type": "VideoObject",
              name: v.title,
              description: `${v.title}, by ${v.by}. made with viralowner.`,
              thumbnailUrl: `${SITE_URL}${v.thumbnail}`,
              uploadDate: v.postedOn,
              url: v.url,
              interactionStatistic: [
                { "@type": "InteractionCounter", interactionType: { "@type": "WatchAction" }, userInteractionCount: v.views },
                { "@type": "InteractionCounter", interactionType: { "@type": "LikeAction" }, userInteractionCount: v.likes },
              ],
            },
          }
        : {}),
    })),
  };
}

/** "as of Nov 13". */
function countedLabel(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : `as of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

function HeartIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 20.7l-1.3-1.2C5.9 15.2 3 12.6 3 9.4 3 6.9 5 5 7.4 5c1.4 0 2.8.7 3.6 1.7h2C13.8 5.7 15.2 5 16.6 5 19 5 21 6.9 21 9.4c0 3.2-2.9 5.8-7.7 10.1L12 20.7z" />
    </svg>
  );
}
