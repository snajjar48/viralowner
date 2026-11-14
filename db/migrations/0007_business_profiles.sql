-- What each user's business is, asked once and used on every video: the name and the
-- words to spell right (captions, text, post captions), what they sell, where they are.
CREATE TABLE IF NOT EXISTS business_profiles (
  user_id     UUID PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  about       TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  words       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
