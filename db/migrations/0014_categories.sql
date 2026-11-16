-- The kind of video the user picked when starting it (lib/categories.ts): food & drink, skits,
-- talking head, influencer / vlog, event recap, travel. Earlier projects have none.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS projects_category_idx ON projects (category) WHERE category IS NOT NULL;

-- Lessons learned per category, next to the ones for every video (category NULL).
ALTER TABLE editor_lessons ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS editor_lessons_category_idx ON editor_lessons (category, created_at DESC);
