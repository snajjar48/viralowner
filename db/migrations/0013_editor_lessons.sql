-- What the editor learned from everyone's change requests, notes and feedback (made daily by
-- /api/cron/learn). Every new version is made with the latest lessons.
CREATE TABLE IF NOT EXISTS editor_lessons (
  id            BIGSERIAL PRIMARY KEY,
  lessons       TEXT[] NOT NULL,
  source_count  INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
