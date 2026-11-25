-- The iPhone app's push notifications ("your video is ready"): one row per phone, for the account
-- signed in on it. A phone that signs in to another account moves to that account.
CREATE TABLE IF NOT EXISTS push_tokens (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_id ON push_tokens (user_id);
