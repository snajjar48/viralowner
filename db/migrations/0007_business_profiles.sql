-- What each user tells us about themselves, asked once and used on every video: their business
-- name and the words to spell right (captions, text, post captions), what they sell, where they
-- are, their role, what they use the site for, and anything else to remember.
CREATE TABLE IF NOT EXISTS business_profiles (
  user_id     UUID PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  about       TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  words       TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT '',
  purpose     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
