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
| `src/lib/processing/` | **The processing engine interface** (`analyzeInspo`, `startRender`, `getJobStatus`). Currently a mock: fake shot lists, a ~20s simulated render, and one sample video (`assets/mock/mock-render.mp4`). Put `#fail` in the on-screen text option to test a failed render. |
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
