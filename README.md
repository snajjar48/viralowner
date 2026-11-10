# viralowner

Waitlist landing page. Next.js (App Router) + TypeScript + Tailwind, with signups stored in Neon Postgres.

## What's here

| Path | Purpose |
| --- | --- |
| `src/app/page.tsx` | The landing page (the only public page) |
| `src/app/waitlist-form.tsx` | Email form, honeypot field, success message |
| `src/app/api/waitlist/route.ts` | `POST /api/waitlist`: validation, honeypot, rate limit, insert |
| `src/lib/rate-limit.ts` | 5 attempts per IP per 10 minutes, stored in Postgres (IPs are hashed) |
| `db/schema.sql` | Tables: `waitlist_signups` (unique on lowercased email), `rate_limits` |

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
4. **Create the tables** (one time, safe to rerun):
   ```sh
   npm run db:setup
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
