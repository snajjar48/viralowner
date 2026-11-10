-- ViralOwner database schema. Safe to run more than once.

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One signup per email, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_email_lower_idx
  ON waitlist_signups (lower(email));

-- Fixed-window rate limit counters, keyed by a SHA-256 hash of the client IP
-- (raw IPs are never stored).
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);
