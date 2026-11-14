-- A name the user gives each video project (shown on the dashboard). Empty: we show one made
-- from the prompt or the date.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';

-- When the user deleted it. Its files and clips are gone; the row stays only so the videos it
-- used still count toward the month (and the free trial stays used).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
