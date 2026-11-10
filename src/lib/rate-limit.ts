import "server-only";
import { createHash } from "node:crypto";
import { getSql } from "./db";

const WINDOW_SECONDS = 10 * 60; // 10 minutes
const MAX_REQUESTS = 5; // per IP per window

function hashKey(value: string) {
  return createHash("sha256").update(`viralowner:${value}`).digest("hex");
}

/**
 * Fixed-window rate limiter stored in Postgres, so it holds across serverless
 * instances. Returns true if the request is allowed.
 */
export async function checkRateLimit(id: string): Promise<boolean> {
  // Local development without a database: skip rate limiting.
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === "development") {
    return true;
  }

  const sql = getSql();
  const key = hashKey(id);
  const windowStart = new Date(
    Math.floor(Date.now() / (WINDOW_SECONDS * 1000)) * WINDOW_SECONDS * 1000,
  ).toISOString();

  const rows = await sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start)
    DO UPDATE SET count = rate_limits.count + 1
    RETURNING count
  `;

  // Occasionally clean up old windows (roughly 1 in 50 requests).
  if (Math.random() < 0.02) {
    await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  }

  return Number(rows[0].count) <= MAX_REQUESTS;
}
