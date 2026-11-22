import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { FlowShell, PageTitle } from "@/components/flow-shell";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { getUserId } from "@/lib/auth";

export const metadata: Metadata = {
  title: "tips",
  robots: { index: false, follow: false },
};

/**
 * Tips for signed-in users: finding ideas, picking a video to remake, filming, remaking, starting from
 * scratch, text and hooks, and what to do once it's made. Drawn from the editing playbooks
 * (worker/assets/playbook) and how the app works; no made-up numbers.
 */
type Tip = { title: string; body: ReactNode };
type Group = { id: string; title: string; intro: string; tips: Tip[]; cta?: { label: string; href: string } };

const GROUPS: Group[] = [
  {
    id: "ideas",
    title: "coming up with video ideas",
    intro: "you don’t need an original idea. you need a format that already works, with you in it.",
    tips: [
      {
        title: "borrow the format, not the video",
        body: "save videos that stop your scroll, even outside your industry. ask what makes them work (the hook, the twist, the pacing) and put your business in that shape.",
      },
      {
        title: "look outside your niche",
        body: "a skit from an office, a tour of a hotel room or a food reveal can all work for a salon, a gym or a shop. the format travels, your product is the twist.",
      },
      {
        title: "talk to one person",
        body: "picture one customer before you film. “if you’re a nurse who’s always on nights…” beats “hey everyone”. it’s fine to reach fewer people if they’re the right ones.",
      },
      {
        title: "rotate three kinds of videos",
        body: "something useful (a tip, a how-to), something that makes people feel (a story, a before and after) and something fun (a skit, a trend). it keeps your page from feeling like ads.",
      },
      {
        title: "answer real questions",
        body: "the questions customers ask you every week are ready-made videos. so are the myths you’re tired of hearing and the mistakes you see people make.",
      },
      {
        title: "turn hits into a series",
        body: (
          <>
            when one lands, make part 2. set the part number under “series” in the options and we add a small “part 2”
            label and mention it in the post caption.
          </>
        ),
      },
      {
        title: "keep a running list",
        body: "jot ideas in your phone the moment you see them, then film a few in one go. a batch day gives you a week of posts.",
      },
    ],
  },
  {
    id: "picking",
    title: "picking a video to remake",
    intro: "the video you upload is the blueprint. a good pick does half the work.",
    tips: [
      {
        title: "pick one that’s clearly working",
        body: "go for videos that did well for an account that size, not just ones you like. the format is what you’re borrowing.",
      },
      {
        title: "make sure you can film it",
        body: "check you have (or can get) every shot: the place, the props, the people. after you upload, the shot list tells you exactly what each shot needs.",
      },
      {
        title: "simple beats fancy",
        body: "a few clear shots with a strong idea remake better than a heavy effects edit. effects are easy to add, a good idea isn’t.",
      },
      {
        title: "pick the right category",
        body: "food & drink, skits, talking to the camera, vlogs, event recaps and travel each get edited their own way. picking the right one gets you the right pacing, text and sound.",
      },
      {
        title: "upload the full-quality video",
        body: "save the original rather than a screen recording when you can. we read every shot, cut and piece of text from it, so a clean copy reads best.",
      },
    ],
    cta: { label: "remake a viral video", href: "/new" },
  },
  {
    id: "filming",
    title: "filming your clips",
    intro: "your phone is enough. a few habits make the biggest difference.",
    tips: [
      {
        title: "film vertical",
        body: "hold your phone upright. sideways clips have to be cropped hard to fill the screen.",
      },
      {
        title: "face the light",
        body: "put the window or lamp in front of you, not behind. backlit faces go dark and grainy.",
      },
      {
        title: "film a bit longer than the shot",
        body: "start a second or two early and keep rolling a second or two after. we pick the best moment from each clip, so extra room helps.",
      },
      {
        title: "start with the action",
        body: "the first moments of the video decide if people stay. open on the pour, the reveal, the result or the line, never on an empty counter or a hello.",
      },
      {
        title: "want slow motion? film at 60fps or more",
        body: "slowing ordinary 30fps clips makes them choppy, so we only slow clips filmed at a higher frame rate. pours, splashes and cheese pulls look best this way.",
      },
      {
        title: "keep the important stuff in the middle",
        body: "tiktok and instagram cover the top, the bottom and the right side with buttons and captions. keep faces and products clear of the edges.",
      },
      {
        title: "clean sound when it matters",
        body: "if you’re talking, get close to the phone or use a mic, and turn off fans and music. if the sound doesn’t matter, don’t worry about it.",
      },
      {
        title: "keep the camera steady on the big moment",
        body: "move as much as you like on the in-between shots, but hold still for the payoff so it reads.",
      },
      {
        title: "one sentence, one clip",
        body: "talking to the camera across several clips? switch angle or spot every sentence or two. the changes keep it moving.",
      },
    ],
  },
  {
    id: "remaking",
    title: "remaking a video",
    intro: "upload the video, film your clips, pick your options. here’s how to get it right the first time.",
    tips: [
      {
        title: "follow the shot list",
        body: "each shot has a short note on what to film and how long it runs. match the angle and the action and the edit lines up with the original.",
      },
      {
        title: "one clip can fill several shots",
        body: "you don’t need a new clip for every shot. we use different parts of the same clip. under “advanced” on the options step you can pick the clip for each shot yourself.",
      },
      {
        title: "one-take videos are easy",
        body: "if the original is one person talking with the pauses cut out, just film yourself saying your version. we cut the pauses, retakes and “um”s. messed up a line? say it again, we keep the last good one.",
      },
      {
        title: "put your details in additional requests",
        body: "your business name, what to show off, words to use or avoid, the vibe. the more specific, the closer the first version.",
      },
      {
        title: "fill in your profile once",
        body: (
          <>
            your <Link href="/profile" className="underline underline-offset-4 hover:text-foreground">profile</Link> gets your
            names and products spelled right and your text sounding like you on every video.
          </>
        ),
      },
      {
        title: "preview the plan first",
        body: "it’s free. you see every shot with its text before anything is made, and you can change the words, timing and look right there.",
      },
      {
        title: "your music choice matters",
        body: "keep your clips’ own sound when you’re talking, use the original’s sound for trends, or pick “no music” and add a trending sound in the app when you post.",
      },
    ],
    cta: { label: "remake a viral video", href: "/new" },
  },
  {
    id: "scratch",
    title: "starting from scratch",
    intro: "no example video, just your clips and a description. write it like you’re briefing an editor.",
    tips: [
      {
        title: "say what it’s for",
        body: "a promo for a new item, a behind-the-scenes, a tip, an event recap. the goal decides the length, pace and ending.",
      },
      {
        title: "describe the opening",
        body: "tell us the first shot and the first line or title. “open on the drizzle” or “start with the finished room” gives us a strong hook to build from.",
      },
      {
        title: "name the must-haves",
        body: "products, prices, dates, your handle, any words that have to be on screen. write them exactly how they should appear.",
      },
      {
        title: "give it a vibe",
        body: "fun and playful, calm and cozy, fast and hype. add sounds or effects you want (“pop on each item”, “slow-mo on the pour”) and anything to avoid.",
      },
      {
        title: "pick a length",
        body: "short and punchy for a single reveal, longer for a tour or a list. you can set it before the video is made.",
      },
      {
        title: "upload more clips than you need",
        body: "we watch them all and pick the best moments. variety (close-ups, wides, people, details) gives the edit more to work with.",
      },
    ],
    cta: { label: "start from scratch", href: "/scratch" },
  },
  {
    id: "hooks",
    title: "hooks and on-screen text",
    intro: "the first second or two decides if people watch. the text does a lot of that work.",
    tips: [
      {
        title: "never open with an intro",
        body: "skip “hey guys” and “so today”. lead with the result, the surprise or the question.",
      },
      {
        title: "say who it’s for",
        body: "“if you own a coffee shop…” or “pov: you just moved to austin” tells the right people to stay.",
      },
      {
        title: "keep text short and big",
        body: "a few words people can read in a glance. one idea per piece of text.",
      },
      {
        title: "use the grey words as a guide",
        body: "pick “write my own” on a remake and each box shows what the original has there in grey. type your version over it. a box left blank stays out of your video.",
      },
      {
        title: "show proof",
        body: "saying a number or a result? show the screenshot, receipt or review on screen. you can add them after the video is made, free.",
      },
      {
        title: "end with somewhere to go",
        body: "a reason to follow, comment or visit: “part 2 tomorrow”, “comment ‘menu’”, the address. one ask, not three.",
      },
    ],
  },
  {
    id: "after",
    title: "after your video is made",
    intro: "the first version is a starting point. small fixes are quick.",
    tips: [
      {
        title: "fixes that don’t use a change",
        body: "fixing a caption word, changing the on-screen text (words, timing, place, look) and adding proof screenshots are free.",
      },
      {
        title: "ask for changes in plain words",
        body: "“make the first shot shorter”, “use a whoosh between shots 2 and 3”, “put the price bigger”. be specific about which shot or moment.",
      },
      {
        title: "batch your changes",
        body: "each change makes a new version, so put everything you want into one request. your old versions stay, so you can always go back.",
      },
      {
        title: "flopped? repost it with a new hook",
        body: "same video, a brand-new opening and post caption. often the idea was fine and only the first second wasn’t.",
      },
      {
        title: "post consistently",
        body: "one video rarely makes or breaks you. keep posting, keep what works, and improve one thing each time.",
      },
    ],
  },
  {
    id: "categories",
    title: "quick tips by category",
    intro: "what the viral videos in each category tend to do.",
    tips: [
      {
        title: "food & drink",
        body: "open on food in motion (a pour, a drizzle, a sizzle). film the empty glass or plate first so the pour feels like a payoff. hold the most indulgent moment longest, and never cut a pour halfway.",
      },
      {
        title: "skits",
        body: "set up the premise with one line of text from the start. use the rule of three: two expected beats, then the twist. keep a single gag short and let the silence before the punchline breathe.",
      },
      {
        title: "talking to the camera",
        body: "first word at the very start, no greeting. cut every pause that isn’t on purpose. change something on screen every few seconds (a punch-in, a new spot, a graphic) so it never sits still.",
      },
      {
        title: "travel",
        body: "open on the best view, not the airport. name the place in the first few seconds. reveal views by opening a door, curtain or window, and show proof for every price or deal.",
      },
      {
        title: "vlogs & event recaps",
        body: "lead with the highlight, then rewind. mix wide shots of the space with close-ups of people and details, and end on the best moment.",
      },
    ],
  },
];

export default function TipsPage() {
  return (
    <FlowShell>
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Tips />
      </Suspense>
    </FlowShell>
  );
}

async function Tips() {
  const userId = await getUserId();
  if (!userId) redirect("/login?next=/tips");
  return (
    <>
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
      >
        <ArrowLeftIcon className="size-4" /> dashboard
      </Link>
      <PageTitle
        title="tips"
        subtitle="how to find ideas, film your clips and get a video that’s right the first time."
      />
      <nav aria-label="tip topics" className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-muted transition hover:border-white/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
          >
            {g.title}
          </a>
        ))}
      </nav>
      {GROUPS.map((g) => (
        <section
          key={g.id}
          id={g.id}
          aria-labelledby={`${g.id}-heading`}
          className="flex scroll-mt-6 flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
        >
          <div className="flex flex-col gap-1">
            <h2 id={`${g.id}-heading`} className="text-lg font-medium">
              {g.title}
            </h2>
            <p className="text-sm text-muted text-pretty">{g.intro}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {g.tips.map((tip) => (
              <li key={tip.title} className="flex gap-3">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-linear-to-r from-violet to-coral" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{tip.title}</span>
                  <span className="text-sm text-muted text-pretty">{tip.body}</span>
                </span>
              </li>
            ))}
          </ul>
          {g.cta && (
            <Link
              href={g.cta.href}
              className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
            >
              {g.cta.label} <ArrowRightIcon className="size-4" />
            </Link>
          )}
        </section>
      ))}
    </>
  );
}
