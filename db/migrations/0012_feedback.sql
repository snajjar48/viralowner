-- Feedback people leave on a finished video (the download page), for the admin dashboard and for
-- what the editor learns from everyone's notes. Kept even if the project is deleted later.
CREATE TABLE IF NOT EXISTS feedback (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL,
  project_id  UUID,
  render_id   UUID,
  version     INT,
  rating      TEXT CHECK (rating IN ('loved', 'okay', 'not_quite')),
  message     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_user_idx ON feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC);
