"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Bar, Btn, Card, Chip, Footage, Phone, Radio, Tap, TextBox, Title } from "./mocks";

type Step = { title: string; body: ReactNode; screen: ReactNode; label: string };
type Tutorial = { id: string; name: string; intro: string; steps: Step[]; start?: { label: string; href: string } };

const shots = ["sunset", "sea", "cafe", "green"] as const;

const TUTORIALS: Tutorial[] = [
  {
    id: "remake",
    name: "remake a viral video",
    intro: "upload a video that went viral, film your own clips, and we edit them into the same video with your spin.",
    start: { label: "remake a viral video", href: "/new" },
    steps: [
      {
        title: "upload the video you want to remake",
        body: (
          <>
            open the menu and tap <b>remake</b>, then tap the box to pick the video from your camera roll. got it on
            tiktok or instagram? tap share, then <b>save video</b> (or screen record it).
          </>
        ),
        label: "the upload screen, with the upload box highlighted",
        screen: (
          <>
            <Title sub="upload a video you love. we’ll break down every shot.">which video do you want to recreate?</Title>
            <Tap>
              <span className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/25 bg-white/[0.03] text-center">
                <span className="font-medium">upload the video you want to remake</span>
                <span className="text-muted">tap to choose from your camera roll.</span>
              </span>
            </Tap>
          </>
        ),
      },
      {
        title: "pick what kind of video it is",
        body: "food & drink, skits, talking head, vlog, event recap or travel. each one is edited its own way, so pick the closest. then confirm you’re only using it as a style reference.",
        label: "the category list, with food and drink picked",
        screen: (
          <>
            <Footage tone="cafe" className="h-20" text="the best croffles in town" />
            <p className="font-medium">what kind of video is it?</p>
            <div className="flex flex-wrap gap-1">
              <Tap className="rounded-full">
                <Chip on>food &amp; drink</Chip>
              </Tap>
              <Chip>skits</Chip>
              <Chip>talking head</Chip>
              <Chip>travel</Chip>
            </div>
            <span className="flex items-start gap-1.5 text-[9px] text-muted">
              <span className="mt-0.5 size-2.5 shrink-0 rounded-sm bg-coral" /> i’m using this video only as a style reference.
            </span>
            <span className="mt-auto">
              <Btn>upload &amp; break it down</Btn>
            </span>
          </>
        ),
      },
      {
        title: "read your shot list",
        body: "we find every cut, the pacing and the text. each shot tells you what to film and how long it runs. close enough works great.",
        label: "the shot list, with a note for each shot",
        screen: (
          <>
            <Title sub="film one clip for each shot below.">your shot list</Title>
            {["hook: the drizzle, up close", "setup: the counter", "reveal: first bite", "payoff: the finished plate"].map((s, i) => (
              <Card key={s} className="flex-row items-center">
                <Footage tone={shots[i]} className="h-8 w-5 shrink-0" />
                <span className="flex flex-col">
                  <span className="font-medium">shot {i + 1}</span>
                  <span className="text-[9px] text-muted">{s}</span>
                </span>
              </Card>
            ))}
            <span className="mt-auto">
              <Tap>
                <Btn>looks good, upload my clips</Btn>
              </Tap>
            </span>
          </>
        ),
      },
      {
        title: "add your clips",
        body: "upload everything you filmed, in any order. we watch all of it and pick the best moment for each shot. one clip can fill several shots.",
        label: "the clips screen with four clips uploaded",
        screen: (
          <>
            <Title sub="upload the clips you filmed.">now add your clips</Title>
            <div className="grid grid-cols-4 gap-1">
              {shots.map((t) => (
                <Footage key={t} tone={t} className="aspect-[9/16]" />
              ))}
            </div>
            <span className="flex h-8 items-center justify-center rounded-lg border border-dashed border-white/25 text-muted">add more clips</span>
            <span className="mt-auto">
              <Tap>
                <Btn>continue to options</Btn>
              </Tap>
            </span>
          </>
        ),
      },
      {
        title: "pick your text, music and captions",
        body: (
          <>
            all optional. keep the original’s text, have us write it about your business, or <b>write my own</b>. pick a
            style for the text, the music and the captions. tell us anything else in <b>additional requests</b>.
          </>
        ),
        label: "the options screen: text choices and the style tiles",
        screen: (
          <>
            <Title sub="all optional.">final touches</Title>
            <p className="font-medium">on-screen text</p>
            <Radio title="match the original" />
            <Tap>
              <Radio title="match the style, use my business" sub="same style and placement, words about you" on />
            </Tap>
            <Radio title="write my own" />
            <p className="font-medium">style</p>
            <div className="grid grid-cols-3 gap-1">
              {["like the original", "classic", "social"].map((s, i) => (
                <span key={s} className={`flex flex-col gap-0.5 rounded-md border p-1 ${i === 0 ? "border-coral/70" : "border-white/10"}`}>
                  <span className="flex h-6 items-center justify-center rounded bg-white/5 font-semibold">{i ? "pov: you" : "Aa"}</span>
                  <span className="truncate text-[8px]">{s}</span>
                </span>
              ))}
            </div>
          </>
        ),
      },
      {
        title: "preview the plan (free)",
        body: "see every shot with its text before anything is made. not right? change something and plan it again. it doesn’t use a video.",
        label: "the free preview: a frame for each shot",
        screen: (
          <>
            <Tap>
              <Btn ghost>preview the plan first · free</Btn>
            </Tap>
            <Card>
              <span className="font-medium">your preview</span>
              <div className="grid grid-cols-3 gap-1">
                {(["cafe", "sunset", "green"] as const).map((t, i) => (
                  <span key={t} className="flex flex-col gap-0.5">
                    <Footage tone={t} className="aspect-[9/16] text-[7px]" text={i === 0 ? "pov: best croffle" : undefined} />
                    <span className="text-[8px] text-muted">shot {i + 1}</span>
                  </span>
                ))}
              </div>
            </Card>
          </>
        ),
      },
      {
        title: "make your video",
        body: "tap make my video. it takes a few minutes. you can leave the page, we email you when it’s ready.",
        label: "making the video: the progress bar and stages",
        screen: (
          <>
            <Title sub="about 2 min left.">making your video...</Title>
            <Bar value={55} />
            {["analyzing", "matching", "editing", "finishing"].map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className={`flex size-4 items-center justify-center rounded-full text-[8px] ${
                    i < 2 ? "bg-white/15" : i === 2 ? "bg-linear-to-r from-violet to-coral" : "border border-white/15 text-muted"
                  }`}
                >
                  {i < 2 ? "✓" : i + 1}
                </span>
                <span className={i > 2 ? "text-muted" : ""}>{s}</span>
              </span>
            ))}
            <span className="mt-auto text-center text-[9px] text-muted">you can leave this page. we’ll email you when it’s ready.</span>
          </>
        ),
      },
    ],
  },
  {
    id: "scratch",
    name: "start from scratch",
    intro: "no example video needed. describe what you want, add your clips, and we plan the whole edit. start from scratch is part of Pro.",
    start: { label: "start from scratch", href: "/scratch" },
    steps: [
      {
        title: "describe your video",
        body: "open the menu and tap from scratch. pick the kind of video, then tell us like you’d tell an editor: what it’s for, the first shot, the words that must be on screen, the vibe.",
        label: "the describe your video screen with a filled-in description",
        screen: (
          <>
            <Title>describe your video</Title>
            <div className="flex flex-wrap gap-1">
              <Chip on>food &amp; drink</Chip>
              <Chip>event recap</Chip>
            </div>
            <Tap>
              <span className="block h-24 rounded-lg border border-white/15 bg-[#15151b] p-1.5 text-[9px]">
                a 15 second promo for our new strawberry croffle. open on the drizzle, quick cuts, end on “only this weekend”.
                fun and playful.
              </span>
            </Tap>
            <span className="mt-auto">
              <Btn>next: add your clips</Btn>
            </span>
          </>
        ),
      },
      {
        title: "add your clips and pick a length",
        body: "upload more than you need: close-ups, wides, people, details. we watch them all. pick 10, 15, 30 or 60 seconds, or any length.",
        label: "clips added and the length picker",
        screen: (
          <>
            <div className="grid grid-cols-4 gap-1">
              {[...shots, "night" as const, "sea" as const].map((t, i) => (
                <Footage key={i} tone={t} className="aspect-[9/16]" />
              ))}
            </div>
            <p className="font-medium">length</p>
            <div className="flex flex-wrap gap-1">
              <Chip>10s</Chip>
              <Tap className="rounded-full">
                <Chip on>15s</Chip>
              </Tap>
              <Chip>30s</Chip>
              <Chip>60s</Chip>
            </div>
          </>
        ),
      },
      {
        title: "pick the text: we write it, or you do",
        body: "we write it gives you short, punchy text from your description and clips. write my own puts in your exact words. or have none.",
        label: "the on-screen text choices for start from scratch",
        screen: (
          <>
            <p className="font-medium">on-screen text</p>
            <Tap>
              <Radio title="we write it" sub="short, punchy text from your prompt and clips" on />
            </Tap>
            <Radio title="write my own" sub="your exact words and lines" />
            <Radio title="no on-screen text" />
          </>
        ),
      },
      {
        title: "preview, then make it",
        body: "the free preview shows the shots we picked and the text on each. happy? tap make my video.",
        label: "the preview frames and the make my video button",
        screen: (
          <>
            <div className="grid grid-cols-3 gap-1">
              {(["cafe", "green", "sunset"] as const).map((t, i) => (
                <Footage key={t} tone={t} className="aspect-[9/16] text-[7px]" text={i === 0 ? "new: strawberry croffle" : undefined} />
              ))}
            </div>
            <span className="mt-auto">
              <Tap>
                <Btn>make my video</Btn>
              </Tap>
            </span>
          </>
        ),
      },
    ],
  },
  {
    id: "text",
    name: "edit your on-screen text",
    intro: "change the words, when each text shows, where it sits and how it looks, before or after the video is made.",
    steps: [
      {
        title: "write over the original’s words",
        body: "on a remake, pick write my own. each box shows what the original has there in grey. type your version over it. a box left blank stays out of your video. fill in all as shown copies the grey words.",
        label: "write my own: boxes with the original’s words in grey",
        screen: (
          <>
            <Radio title="write my own" on />
            <span className="rounded-md bg-white/[0.04] p-1.5 text-[9px] text-muted">the grey words show what the original has there.</span>
            <Tap>
              <TextBox value="📍Austin, Texas" />
            </Tap>
            <TextBox hint="2008 Mustang GT" />
            <TextBox hint="$12,000" />
          </>
        ),
      },
      {
        title: "change the text we wrote",
        body: "with the free preview, the text we wrote shows up as boxes. change any word and your choice stays picked, marked with your edits. undo my changes puts ours back.",
        label: "our text in editable boxes, marked with your edits",
        screen: (
          <>
            <Radio title="match the original · with your edits" on />
            <Card className="border-coral/30 bg-coral/[0.05]">
              <span className="flex items-center justify-between font-medium">
                the text we wrote for your preview <span className="text-[8px] font-normal text-muted">undo my changes</span>
              </span>
            </Card>
            <TextBox value="pov: you found it" />
            <Tap>
              <TextBox value="ask for sami" />
            </Tap>
          </>
        ),
      },
      {
        title: "set when it shows",
        body: "tap when it shows. drag the coral handles like trimming a clip, or tap the shots it should be on. leave it and we time it.",
        label: "the timing strip with drag handles and shot chips",
        screen: (
          <>
            <TextBox value="$24,500" />
            <Tap>
              <span className="flex h-9 items-stretch gap-0.5 rounded-md bg-white/5 p-0.5">
                <span className="w-1.5 rounded-l bg-coral" />
                {shots.map((t) => (
                  <Footage key={t} tone={t} className="flex-1 rounded-none" />
                ))}
                <span className="w-1.5 rounded-r bg-coral" />
              </span>
            </Tap>
            <div className="flex flex-wrap gap-1">
              <Chip>whole video</Chip>
              <Chip on>1</Chip>
              <Chip on>2</Chip>
              <Chip>3</Chip>
              <Chip>4</Chip>
            </div>
          </>
        ),
      },
      {
        title: "style and place it",
        body: "tap style & place for height, size, color, font and animation. a text you style yourself keeps its own look, even if you pick a style for the whole video.",
        label: "the style and place panel",
        screen: (
          <>
            <TextBox value="$24,500" own />
            <Card>
              <span className="text-muted">height on screen</span>
              <Bar value={62} />
              <span className="text-muted">size</span>
              <Bar value={40} />
              <span className="flex items-center gap-1">
                <span className="text-muted">color</span>
                {["#FFFFFF", "#FFD84D", "#FF6B5A", "#4DA3FF"].map((c, i) =>
                  i === 1 ? (
                    <Tap key={c} className="rounded-full" tag="✓">
                      <span className="block size-3.5 rounded-full" style={{ background: c }} />
                    </Tap>
                  ) : (
                    <span key={c} className="size-3.5 rounded-full" style={{ background: c }} />
                  ),
                )}
              </span>
              <span className="text-muted">font: heavy</span>
            </Card>
          </>
        ),
      },
      {
        title: "keep it exactly where the original has it",
        body: "text near the bottom normally moves up just enough to stay clear of tiktok’s and instagram’s buttons. switch this on to keep the original’s exact spot.",
        label: "the keep the text exactly where the original has it switch",
        screen: (
          <>
            <Footage tone="sea" className="aspect-[4/5]">
              <span className="absolute inset-x-0 bottom-[8%] text-center font-bold text-white [text-shadow:0_1px_2px_#000]">$24,500</span>
              <span className="absolute top-[30%] right-1 flex flex-col gap-1.5 opacity-70">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-2.5 rounded-full bg-white" />
                ))}
              </span>
            </Footage>
            <span className="flex items-center justify-between gap-2">
              <span>keep the text exactly where the original has it</span>
              <Tap className="rounded-full">
                <span className="relative block h-4 w-7 rounded-full bg-linear-to-r from-violet to-coral">
                  <span className="absolute top-0.5 right-0.5 size-3 rounded-full bg-white" />
                </span>
              </Tap>
            </span>
          </>
        ),
      },
    ],
  },
  {
    id: "after",
    name: "after your video is made",
    intro: "download it, fix small things for free, ask for changes, and repost a flop with a new hook.",
    steps: [
      {
        title: "download and copy your post",
        body: "tap download. you also get a post caption and hashtags ready to copy, plus a few other captions to pick from.",
        label: "the finished video with the download button",
        screen: (
          <>
            <Title sub="happy with it? download it.">your video is ready</Title>
            <Footage tone="cafe" className="aspect-[4/5]" text="pov: best croffle" />
            <Tap>
              <Btn>download →</Btn>
            </Tap>
          </>
        ),
      },
      {
        title: "fix your text for free",
        body: "change the words, timing, place or look of any text. the one you’re editing is outlined on the video. save my text remakes it with your text and doesn’t use a change.",
        label: "editing text on the finished video, with the save my text button",
        screen: (
          <>
            <Footage tone="cafe" className="aspect-[9/10]">
              <span className="absolute inset-x-6 top-[30%] rounded border-2 border-dashed border-coral py-1 text-center font-bold text-white [text-shadow:0_1px_2px_#000]">
                pov: best croffle
              </span>
            </Footage>
            <TextBox value="pov: best croffle" />
            <Tap>
              <Btn>save my text · free</Btn>
            </Tap>
          </>
        ),
      },
      {
        title: "fix a caption word or add proof",
        body: "caption words: fix any word and we remake that version, free. show the proof: add a screenshot (a review, a result) and we show it on the words it proves, also free.",
        label: "the caption words box and the proof section",
        screen: (
          <>
            <Card>
              <span className="flex justify-between font-medium">
                caption words <span className="text-[8px] font-normal text-muted">free fix</span>
              </span>
              <span className="rounded-md border border-white/15 bg-[#15151b] p-1 text-[9px]">this changed everything for me...</span>
              <Tap>
                <Btn ghost>fix the captions</Btn>
              </Tap>
            </Card>
            <Card>
              <span className="flex justify-between font-medium">
                show the proof <span className="text-[8px] font-normal text-muted">free</span>
              </span>
              <span className="flex h-8 items-center justify-center rounded-md border border-dashed border-white/25 text-muted">add a screenshot</span>
            </Card>
          </>
        ),
      },
      {
        title: "ask for a change",
        body: "tell us what to change in your own words: the cuts, order, words, effects or sounds. put everything in one request. each change makes a new version, and your old versions stay.",
        label: "the request a change box and the apply button",
        screen: (
          <>
            <p className="font-medium">request a change</p>
            <Tap>
              <span className="block h-16 rounded-lg border border-white/15 bg-[#15151b] p-1.5 text-[9px]">
                make the first shot shorter and add a whoosh between shots 2 and 3
              </span>
            </Tap>
            <div className="flex flex-wrap gap-1">
              <Chip>version 1</Chip>
              <Chip on>version 2</Chip>
            </div>
            <span className="mt-auto">
              <Btn>apply changes (makes a new version)</Btn>
            </span>
          </>
        ),
      },
      {
        title: "flopped? repost it with a new hook",
        body: "same video, a brand-new opening and post caption. or tap regenerate for a fresh take on the whole edit. both use a change.",
        label: "the repost with a new hook and regenerate buttons",
        screen: (
          <>
            <Footage tone="night" className="aspect-[4/5]" text="you’ve been doing this wrong" />
            <Tap>
              <Btn ghost>✦ repost with a new hook</Btn>
            </Tap>
            <Btn ghost>↻ regenerate</Btn>
          </>
        ),
      },
    ],
  },
];

export function Tutorials() {
  const [pick, setPick] = useState(TUTORIALS[0].id);
  // A link like /tutorials#text opens that tutorial.
  useEffect(() => {
    const read = () => {
      const id = location.hash.slice(1);
      if (TUTORIALS.some((t) => t.id === id)) setPick(id);
    };
    const first = setTimeout(read);
    window.addEventListener("hashchange", read);
    return () => {
      clearTimeout(first);
      window.removeEventListener("hashchange", read);
    };
  }, []);
  const tut = TUTORIALS.find((t) => t.id === pick)!;

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="tutorials" className="flex flex-wrap gap-2">
        {TUTORIALS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === pick}
            aria-controls="tutorial-panel"
            onClick={() => {
              setPick(t.id);
              history.replaceState(null, "", `#${t.id}`);
            }}
            className={`h-9 cursor-pointer rounded-full px-3.5 text-sm transition focus-visible:outline-2 focus-visible:outline-coral ${
              t.id === pick ? "bg-linear-to-r from-violet to-coral font-medium text-white" : "border border-white/15 text-muted hover:text-foreground"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <section id="tutorial-panel" role="tabpanel" aria-label={tut.name} className="flex flex-col gap-4">
        <p className="text-sm text-muted text-pretty">{tut.intro}</p>
        <ol className="grid gap-4 lg:grid-cols-2">
          {tut.steps.map((s, i) => (
            <li
              key={s.title}
              className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5 lg:flex-col lg:items-stretch"
            >
              <div className="flex flex-1 flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-linear-to-r from-violet to-coral text-xs font-semibold text-white">
                    {i + 1}
                  </span>
                  <h2 className="text-base font-medium">{s.title}</h2>
                </span>
                <p className="text-sm text-muted text-pretty [&_b]:font-medium [&_b]:text-foreground">{s.body}</p>
              </div>
              <div className="sm:w-60 lg:w-auto">
                <Phone label={s.label}>{s.screen}</Phone>
              </div>
            </li>
          ))}
        </ol>
        {tut.start && (
          <Link
            href={tut.start.href}
            className="inline-flex h-11 w-fit items-center gap-2 self-center rounded-full bg-linear-to-r from-violet to-coral px-5 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-coral"
          >
            {tut.start.label} →
          </Link>
        )}
      </section>
    </div>
  );
}
