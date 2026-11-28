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
  /** What kind of business, e.g. "ice cream shop". */
  kind: string;
  /** A few words about the video. */
  title: string;
  /**
   * Exactly as the post (or its owner's analytics) showed them on `countedOn`. Leave out any number we
   * weren't given: never estimate one.
   */
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  /** New followers from this video. */
  followers?: number;
  /** Total watch time, in minutes. */
  watchMinutes?: number;
  /** When the numbers were counted (YYYY-MM-DD). */
  countedOn: string;
  /** When it was posted (YYYY-MM-DD), if known. */
  postedOn?: string;
  /** Path under /public, e.g. "/showcase/crepe-escape-boba.jpg". */
  thumbnail: string;
  /** Shown on the home page. */
  featured?: boolean;
}

// Numbers sent by the owners on 2026-11-28; all three gave permission to show their videos.
const BRUSTERS = { by: "Bruster’s Real Ice Cream North Olmsted", kind: "ice cream shop" };
const CREPESCAPE = { by: "CREPEscape", kind: "dessert shop" };
const AL_JABAL = { by: "Al Jabal Olive Oil", kind: "olive oil business" };

export const SHOWCASE: ShowcaseVideo[] = [
  {
    ...CREPESCAPE,
    url: "https://www.tiktok.com/@crepescape_/video/7707798070288796958",
    title: "behind the counter at CREPEscape",
    views: 111_700,
    likes: 6_077,
    comments: 87,
    shares: 688,
    saves: 277,
    followers: 50,
    watchMinutes: 377 * 60 + 54,
    countedOn: "2026-11-28",
    postedOn: "2026-11-13",
    thumbnail: "/showcase/crepescape-tiktok-1.jpg",
    featured: true,
  },
  {
    ...BRUSTERS,
    url: "https://www.instagram.com/reel/Df0WEMeyyMM/",
    title: "“how many samples have you had today?”",
    views: 36_226,
    countedOn: "2026-11-28",
    postedOn: "2026-11-16",
    thumbnail: "/showcase/brusters-reel.jpg",
    featured: true,
  },
  {
    ...BRUSTERS,
    url: "https://www.tiktok.com/@brustersnortholmsted/video/7709258444158684429",
    title: "“if you don’t like mint choc chip…”",
    views: 29_300,
    likes: 1_428,
    comments: 133,
    shares: 124,
    saves: 175,
    watchMinutes: 49 * 60 + 40,
    countedOn: "2026-11-28",
    postedOn: "2026-11-17",
    thumbnail: "/showcase/brusters-tiktok.jpg",
    featured: true,
  },
  {
    ...CREPESCAPE,
    url: "https://www.tiktok.com/@crepescape_/video/7711886903808675103",
    title: "“I think it’s gonna be slow today”",
    views: 16_400,
    likes: 639,
    shares: 59,
    saves: 27,
    watchMinutes: 34 * 60 + 18,
    countedOn: "2026-11-28",
    postedOn: "2026-11-24",
    thumbnail: "/showcase/crepescape-tiktok-2.jpg",
    featured: true,
  },
  {
    ...CREPESCAPE,
    url: "https://www.instagram.com/reel/DfsyUT7h4rK/",
    title: "behind the counter, on Instagram",
    views: 13_352,
    likes: 203,
    comments: 7,
    shares: 23,
    saves: 23,
    countedOn: "2026-11-28",
    postedOn: "2026-11-13",
    thumbnail: "/showcase/crepescape-reel.jpg",
  },
  {
    ...AL_JABAL,
    url: "https://www.tiktok.com/@aljabal.oliveoil/video/7710338364343389470",
    title: "breakfast with olive oil straight from the farm",
    likes: 1_584,
    shares: 286,
    saves: 145,
    followers: 23,
    watchMinutes: 10 * 60 + 17,
    countedOn: "2026-11-28",
    postedOn: "2026-11-20",
    thumbnail: "/showcase/al-jabal-tiktok-2.jpg",
  },
  {
    ...AL_JABAL,
    url: "https://www.tiktok.com/@aljabal.oliveoil/video/7711117058855030029",
    title: "picking olives at the harvest",
    likes: 2_804,
    comments: 58,
    shares: 427,
    saves: 228,
    followers: 37,
    watchMinutes: 17 * 60 + 19,
    countedOn: "2026-11-28",
    postedOn: "2026-11-22",
    thumbnail: "/showcase/al-jabal-tiktok-1.jpg",
  },
];

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

/** Everything added up, for the headline numbers. */
export function showcaseTotals(videos: ShowcaseVideo[] = SHOWCASE) {
  const sum = (k: "views" | "likes" | "comments" | "shares" | "saves" | "followers" | "watchMinutes") =>
    videos.reduce((n, v) => n + (v[k] ?? 0), 0);
  return {
    videos: videos.length,
    businesses: new Set(videos.map((v) => v.by)).size,
    views: sum("views"),
    likes: sum("likes"),
    comments: sum("comments"),
    shares: sum("shares"),
    saves: sum("saves"),
    followers: sum("followers"),
    watchHours: Math.floor(sum("watchMinutes") / 60),
  };
}

/** 2980 → "49h 40m". */
export function watchTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** The home page's few: featured first, then the rest in order. */
export function featuredVideos(count = 4) {
  return [...SHOWCASE.filter((v) => v.featured), ...SHOWCASE.filter((v) => !v.featured)].slice(0, count);
}
