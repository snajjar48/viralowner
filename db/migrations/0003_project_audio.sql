-- A project can have the user's own audio file (voiceover or music) to use as
-- the video's sound. One per project; see ProjectAudio in src/lib/projects.ts.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS audio jsonb;
