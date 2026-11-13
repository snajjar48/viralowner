# viralowner

Waitlist landing page. Next.js (App Router) + TypeScript + Tailwind, with signups stored in Neon Postgres.

## What's here

| Path | Purpose |
| --- | --- |
| `src/app/page.tsx` | The landing page (the only public page) |
| `src/app/waitlist-form.tsx` | Email form, honeypot field, success message |
| `src/app/api/waitlist/route.ts` | `POST /api/waitlist`: validation, honeypot, rate limit, insert |
| `src/lib/rate-limit.ts` | 5 attempts per IP per 10 minutes, stored in Postgres (IPs are hashed) |
| `db/migrations/` | Numbered SQL migrations (waitlist, rate limits, video projects). Applied by `npm run db:migrate` |

## Setup

1. **Deploy to Vercel**: import this GitHub repo at <https://vercel.com/new>.
2. **Add Neon**: in the Vercel project, go to **Storage → Create Database → Neon (Serverless Postgres)**, accept the terms, choose a region close to your Vercel functions, and connect it to all environments. This sets `DATABASE_URL` for you.
3. **Pull env vars locally**:
   ```sh
   npm i -g vercel
   vercel login
   vercel link
   vercel env pull .env.local
   ```
4. **Create or update the tables** (applies only new migrations, safe to rerun):
   ```sh
   npm run db:migrate
   ```
5. **Redeploy** on Vercel (Deployments → ⋯ → Redeploy) so the live site picks up the database.

## Local development

```sh
npm install
npm run dev   # http://localhost:3000
```

## Viewing signups

In the Neon console (Vercel → Storage → your database → **Open in Neon**), open the SQL Editor and run:

```sql
SELECT email, created_at FROM waitlist_signups ORDER BY created_at DESC;
```

## Plans and the free trial

| | Price | Videos | Changes per video |
| --- | --- | --- | --- |
| Free trial | $0, card saved but never charged | 1 (plus a free download) | 1 (3 once they subscribe) |
| Basic | Stripe `STRIPE_PRICE_BASIC_MONTHLY` / `_YEARLY` | 10 a month | 3 |
| Pro | Stripe `STRIPE_PRICE_PRO_MONTHLY` / `_YEARLY` | up to 30 a month | 3 |

- Limits live in `src/lib/plan-format.ts`; the rules in `src/lib/membership.ts`.
- A video counts when its first version starts (`projects.billing` / `counted_at`). Later versions are changes; failed versions and retries are free.
- Yearly plans reset videos monthly, on the day they subscribed. Nothing carries over. The trial video never counts toward the plan.
- The trial saves the card with a SetupIntent (`/api/auth/signup`), then `/api/billing/trial` (and the `setup_intent.succeeded` webhook) records it in `trial_claims`: one per account and per card fingerprint.
- **Nobody is ever subscribed automatically.** Trial users subscribe only on `/plans` by picking a plan, ticking the terms and pressing subscribe (`/api/billing/subscribe`). Plan switches, card updates and cancelling go through Stripe's billing portal (limited to viralowner prices).
- The Stripe webhook needs these events: `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed` and `setup_intent.succeeded`.

## Emails

Sent through Resend (`src/lib/email.ts`, `RESEND_API_KEY`) from `hello@viralowner.com`. Supabase also sends its account emails through Resend (custom SMTP).

| Email | When | Code |
| --- | --- | --- |
| your video is ready / we couldn’t finish it | the worker calls `/api/worker/render-done` a few seconds after a render returns; the site re-checks the result, then emails once (`renders.emailed_at`) | `src/lib/notify.ts`, `notify_job` in `worker/app.py` |
| your free video is waiting | the trial is first recorded | `emailTrialWelcome` |
| welcome to Basic/Pro | a subscription first becomes active | `emailPlanWelcome` (from `syncSubscription`) |
| confirm your email, reset your password | Supabase | `supabase/email-templates/` (paste into Supabase → Authentication → Emails) |

Payment receipts come from Stripe itself.

## Create-a-video flow

`/new` → `/projects/[id]/breakdown` → `/clips` → `/options` → `/status` → `/preview` → `/export`

| Path | Purpose |
| --- | --- |
| `src/lib/processing/` | **The processing engine interface** (`startAnalysis`, `startRender`, `getJobStatus`…). `modal.ts` talks to the worker below. |
| `src/lib/storage.ts` | Cloudflare R2 with short-lived signed URLs; video bytes never pass through Vercel |
| `src/lib/mp4.ts` | Reads a video's real length from its MP4/MOV header (server-side validation) |
| `src/lib/projects.ts` | Database access; every query is scoped to the signed-in user |
| `db/migrations/0001_video_projects.sql` | `projects`, `inspirations`, `clips`, `renders` |

## Processing worker (Modal)

Video analysis and editing run on [Modal](https://modal.com) (`worker/app.py`),
because they need ffmpeg and minutes of compute that Vercel functions don't
allow. The site talks to it over HTTPS with a shared `WORKER_TOKEN`.

| Task | Command |
|---|---|
| Save keys (Anthropic, R2 worker token) and the shared token | `bash scripts/setup-worker-secrets.sh` |
| Deploy the worker | `npm run worker:deploy` (needs the `modal` CLI: `uv tool install --python 3.12 modal`) |
| Check it end to end (health + a test job) | `npm run worker:check` |
| Check the live site can reach it (logged in) | open `/api/worker-health` |

Modal secrets: `viralowner-worker` (ANTHROPIC_API_KEY, R2_*), `viralowner-worker-auth` (WORKER_TOKEN).

What it does:

- **Inspo analysis**: cut detection (PySceneDetect), speech (faster-whisper), then
  Claude reads frames from every shot and writes the breakdown.
- **Rendering**: Claude picks a clip and moment for every shot and writes the
  on-screen text, post caption and hashtags; ffmpeg cuts each shot to the inspo's
  exact length at 1080×1920 (HDR footage is tone-mapped), joins them, and burns in
  text and captions (ASS subtitles, Montserrat). Edits that keep the clips and
  text skip Claude. The finished MP4 goes to R2 next to the project's other files.
- **Copying the inspo's look**: analysis also reads the inspo's editing style
  (transition into each shot, motion effects, color filter, and its text: font,
  colors, outline/box, size, alignment, animation, placement and line breaks).
  Renders rebuild it with ffmpeg `xfade`/`zoompan` filters and 9 free fonts
  (installed in the worker image). On-screen text modes: `match` (the inspo's
  exact words and lines), `adapt` (its style, words about the user's business),
  `custom` (the user's own lines, exactly as typed).
- **One-take inspos** ("jump cuts": one person talking with every pause cut out)
  are detected during analysis (`style.editType`). Users then upload one long
  take; the render transcribes it stretch by stretch (so Whisper can't drop
  a repeated line), splits it into lines, finds lines said more than once,
  measures each take's delivery (clarity, filler, pauses, pace and loudness vs
  the rest), and Claude keeps the one best take of each line. A final check
  guarantees nothing is said twice in a row and lines stay in script order.
  The kept lines, cut again at every pause, become the cuts (with the inspo's
  alternating zoom, text, captions and color). The cuts are saved in the plan
  (`jumpcut`) so edits reuse them; regenerate cuts the take again.
- **Safe zone**: text and captions always stay clear of the TikTok/Instagram
  interface (top bar, bottom caption area, right-hand buttons): `SAFE` in
  `worker/app.py`.
- **Own audio**: on the clips step users can add their own audio file (MP3,
  M4A, AAC, WAV, 50 MB) after accepting the audio rights notice
  (`src/components/audio-rights.tsx`, the same one as "use the inspo's audio").
  It's stored on `projects.audio` and becomes the "use my audio file" music
  option; captions follow what's said in it.
- The "pick a track" music option keeps the clips' audio until a licensed music
  library is added.

Try it from a laptop without the website:

```bash
modal run worker/app.py::try_analyze --path inspo.mp4
modal run worker/app.py::try_render --inspo inspo.mp4 --clips a.mp4,b.mp4 --dest out.mp4 --captions karaoke
modal run worker/app.py::download --key u/…/renders/v1-….mp4 --dest out.mp4
```

### Transitions, effects and sound effects

- **Recognizing them (analysis):** cuts are found two ways: hard cuts (scene detection) and cuts hidden inside transitions (`transition_cuts`: the picture 0.4s before and after is a different scene). Each cut is measured frame by frame (`cut_signals`: how fast it changes, flashes, dips, motion blur, which way and how fast the picture moves, zoom, spin, shake, color split, warm light), and `listen` uses CLAP (an open sound model baked into the image) to hear new sounds at each cut and inside shots. Claude sees a dense filmstrip of every cut plus those measurements and picks from the catalog: `TRANSITION_INFO`, `MOTION_INFO`, `SPEED_INFO`, `SHOT_EFFECT_INFO`, `LOOK_INFO`, `SFX_INFO`. The sound model notices sounds well but names them poorly over music, so Claude makes the final call with what it sees.
- **Making them (render):** blends use ffmpeg's xfade; whips, zooms, spins, glitches, shakes, light leaks and blurs are drawn onto the end of the outgoing shot and the start of the incoming one (`fx_filter`, `windowed`), so the cut stays on time. Speeds, freeze frames, zoom pulses, flashes and looks are applied per shot or over the whole video. The **fire** transition lays simulated flames over the finished video (`make_fire`, three variations built into the image at build time, `fire_overlays`): they climb up, cover the whole frame for about 0.3s with the cut in the middle, then burn off. Sound effects are real recordings in `worker/assets/sfx` (sources in `SOURCES.md` there), trimmed and leveled; `SFX_HITS` says when each one "hits" so its peak lands on the cut (a riser tops out on it, a whoosh peaks on it). `synth_sfx` is only a fallback. The inspo's own sound effects aren't added again when the video uses the inspo's audio.
- **Asking for them:** "additional requests" (first video) and "request a change" always go through `plan_effects` (Claude reads every request and changes nothing when it isn't about effects). Each version saves its effects in `plan.effects`; edits keep them.
- **Testing:** `modal run worker/app.py::try_render ... --transitions whip_left,zoom_in --sfx whoosh@1,pop@s2` renders with chosen effects; `try_detect --path video.mp4` prints the cuts found and what the sound model hears.
- Older analyses (style `version` < `STYLE_VERSION`) get their style worked out again on their next render.
- Watermarks and @handles in an inspo are never copied as on-screen text (`edit_text`).
