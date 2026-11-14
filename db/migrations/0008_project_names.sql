-- A name the user gives each video project (shown on the dashboard). Empty: we show one made
-- from the prompt or the date.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
