// MOCK processing engine. Nothing here looks at the actual videos.
//
// - analyzeInspo returns a realistic, made-up breakdown (stable per inspo).
// - startRender returns a job id that encodes its start time, so
//   getJobStatus can work out the current stage on any server instance
//   without storing anything (a render "takes" about 20 seconds).
// - Every finished render points at the same sample 9:16 video.
//
// Testing tip: put "#fail" in the on-screen text option to make a render
// fail partway through, so you can see the error and "try again" states.

import type {
  AnalyzeInput,
  Breakdown,
  JobStage,
  JobStatus,
  ProcessingEngine,
  RenderInput,
  Shot,
  ShotRole,
} from "./types";

/** Copied into storage on first use by ensureMockRenderInStorage (./mock-output.ts). */
export const MOCK_RENDER_KEY = "samples/mock-render.mp4";

const RENDER_MS = 20_000;
const ANALYZE_MS = 2_500;

// When each stage starts, as a fraction of the whole render.
const STAGE_STARTS: [JobStage, number][] = [
  ["analyzing", 0],
  ["matching", 0.2],
  ["editing", 0.45],
  ["finishing", 0.85],
];

const TIPS: Record<ShotRole, string[]> = {
  hook: [
    "a close-up of you reacting, looking right into the camera",
    "start mid-action: walk into frame holding the product",
    "a bold statement to camera, face filling the frame",
  ],
  setup: [
    "show the problem: the messy before, filmed from above",
    "a wide shot of your space so people know where they are",
    "you explaining the idea in one sentence, waist up",
  ],
  build: [
    "hands at work, close-up, moving steadily",
    "a quick walk-through, holding the phone at chest height",
    "two or three fast cutaways of the details",
  ],
  reveal: [
    "the big reveal: pull the camera back slowly",
    "turn the product toward the camera in good light",
    "the after shot, same angle as the before",
  ],
  payoff: [
    "your genuine reaction to the result",
    "a customer or friend trying it and smiling",
    "the finished result from a flattering angle",
  ],
  "b-roll": [
    "a slow pan across the details, no talking",
    "a moody close-up of texture or steam or light",
    "a quick shot of your sign, logo or storefront",
  ],
  cta: [
    "point at the screen and tell people what to do next",
    "a friendly wave and your handle or shop name",
    "hold up the product with the price or offer",
  ],
};

const OVERLAY_STYLES = [
  "bold white text, top third",
  "small lowercase labels",
  "big headline on the first shot",
];
const CAPTION_STYLES = [
  "word-by-word pop, bold",
  "clean sentence captions",
  "highlighted words, centered",
];

/** Tiny deterministic PRNG so the same inspo always gets the same breakdown. */
function rng(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], rand: () => number) {
  return items[Math.floor(rand() * items.length)];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function roleFor(i: number, count: number, rand: () => number): ShotRole {
  if (i === 0) return "hook";
  if (i === count - 1) return "cta";
  if (i === count - 2) return "payoff";
  if (i === 1) return "setup";
  if (i === Math.floor(count * 0.65)) return "reveal";
  return rand() < 0.3 ? "b-roll" : "build";
}

export function mockBreakdown({ inspirationId, durationS }: AnalyzeInput): Breakdown {
  const rand = rng(inspirationId);
  const total = Math.min(60, Math.max(3, durationS));
  // Short-form edits cut every 0.8–2.6s; longer videos cut a little slower.
  const targetCut = 0.8 + rand() * 1.2 + total / 60;
  // Capped at 12 shots: more than that is too much to ask people to film.
  const count = Math.max(3, Math.min(12, Math.round(total / targetCut)));

  // Uneven shot lengths, scaled to add up to the real duration.
  const weights = Array.from({ length: count }, (_, i) => (i === 0 ? 0.8 : 0.6 + rand()));
  const sum = weights.reduce((a, b) => a + b, 0);
  let start = 0;
  const shots: Shot[] = weights.map((w, index) => {
    const durationS = index === count - 1 ? round1(total - start) : round1((w / sum) * total);
    const role = roleFor(index, count, rand);
    const shot = { index, role, tip: pick(TIPS[role], rand), startS: round1(start), durationS };
    start += durationS;
    return shot;
  });

  const avgShotS = round1(total / count);
  const label = avgShotS < 1.6 ? "fast" : avgShotS < 3 ? "medium" : "slow";
  const hasText = rand() < 0.75;

  return {
    durationS: round1(total),
    shotCount: count,
    avgShotS,
    pacing: { label, description: `${label}, a cut every ${avgShotS}s` },
    textOverlays: { present: hasText, style: hasText ? pick(OVERLAY_STYLES, rand) : null },
    captionStyle: pick(CAPTION_STYLES, rand),
    shots,
  };
}

function encodeJob(fail: boolean) {
  return `mock_${fail ? "f" : "o"}_${Date.now()}`;
}

function decodeJob(jobId: string) {
  const match = /^mock_([fo])_(\d+)$/.exec(jobId);
  return match ? { fail: match[1] === "f", startedAt: Number(match[2]) } : null;
}

export const mockEngine: ProcessingEngine = {
  async analyzeInspo(input) {
    await sleep(ANALYZE_MS);
    return mockBreakdown(input);
  },

  async startRender(input: RenderInput) {
    const fail = input.settings.options.text.custom.toLowerCase().includes("#fail");
    return { jobId: encodeJob(fail) };
  },

  async getJobStatus(jobId) {
    const job = decodeJob(jobId);
    if (!job) return { state: "failed", stage: null, progress: 0, error: "we lost track of this video. please try again." };

    const fraction = Math.min(1, Math.max(0, (Date.now() - job.startedAt) / RENDER_MS));
    if (job.fail && fraction >= 0.6) {
      return {
        state: "failed",
        stage: "editing",
        progress: 60,
        error: "something went wrong while editing your video. it's not you, it's us.",
      };
    }
    if (fraction >= 1) {
      return {
        state: "done",
        stage: "finishing",
        progress: 100,
        output: {
          storageKey: MOCK_RENDER_KEY,
          width: 1080,
          height: 1920,
          durationS: 8,
          postCopy: {
            caption: "nobody told me it could be this easy 👀 filmed it in 10 minutes, zero editing. would you try this?",
            hashtags: ["#smallbusiness", "#behindthescenes", "#fyp", "#creatortips", "#shopsmall", "#viralvideo", "#beforeandafter"],
          },
        },
      };
    }
    const stage = [...STAGE_STARTS].reverse().find(([, s]) => fraction >= s)![0];
    return { state: "processing", stage, progress: Math.max(1, Math.floor(fraction * 100)) } satisfies JobStatus;
  },
};
