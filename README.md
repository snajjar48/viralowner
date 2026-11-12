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

## Create-a-video flow

`/new` → `/projects/[id]/breakdown` → `/clips` → `/options` → `/status` → `/preview` → `/export`

| Path | Purpose |
| --- | --- |
| `src/lib/processing/` | **The processing engine interface** (`startAnalysis`, `startRender`, `getJobStatus`…). `modal.ts` talks to the worker below. (`mock.ts` is the old stand-in engine, no longer used.) |
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
