/**
 * Videos made with viralowner, shown on /made-with-viralowner and (the first few) on the home
 * page. Only real videos that were made with viralowner, with their real numbers: both pages
 * stay hidden while this list is empty.
 *
 * To add one: save its thumbnail (9:16 jpg) as public/showcase/<name>.jpg, then add an entry.
 * The order here is the order shown; `featured` ones go on the home page first.
 */
export interface ShowcaseVideo {
  /** The post: a TikTok, Instagram Reel, YouTube Short or Facebook link. */
  url: string;
  /** The business or creator who posted it. */
  by: string;
  /** A few words about the video. */
  title: string;
  /** Exactly as the post showed them on `countedOn`. */
  views: number;
  likes: number;
  /** When the views and likes were counted (YYYY-MM-DD). */
  countedOn: string;
  /** When it was posted (YYYY-MM-DD), if known. */
  postedOn?: string;
  /** Path under /public, e.g. "/showcase/crepe-escape-boba.jpg". */
  thumbnail: string;
  /** Shown on the home page. */
  featured?: boolean;
}

export const SHOWCASE: ShowcaseVideo[] = [];

export type Platform = "tiktok" | "instagram" | "youtube" | "facebook" | "other";

export function platformOf(url: string): Platform {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
  if (host.endsWith("facebook.com") || host === "fb.watch") return "facebook";
  return "other";
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  other: "watch",
};

/** 1234 → "1.2K", 3400000 → "3.4M". */
export function compactNumber(n: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** The home page's few: featured first, then the rest in order. */
export function featuredVideos(count = 4) {
  return [...SHOWCASE.filter((v) => v.featured), ...SHOWCASE.filter((v) => !v.featured)].slice(0, count);
}
