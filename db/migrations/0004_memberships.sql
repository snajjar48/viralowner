-- Free trial and plan limits (see src/lib/membership.ts).

-- How a video counted against the account: its free trial video, or one of
-- the plan's monthly videos. Set when the video's first version is started.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing TEXT
  CHECK (billing IS NULL OR billing IN ('trial', 'plan'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS counted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS projects_user_counted_idx
  ON projects (user_id, counted_at) WHERE counted_at IS NOT NULL;

-- One free trial per account and per card. The card fingerprint is Stripe's
-- id for a card number, the same across accounts, so a second account with the
-- same card doesn't get another free video.
CREATE TABLE IF NOT EXISTS trial_claims (
  user_id           UUID PRIMARY KEY,
  card_fingerprint  TEXT NOT NULL UNIQUE,
  claimed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
