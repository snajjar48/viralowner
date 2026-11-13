-- "Start from scratch" videos (Pro): no inspo. The user uploads clips and
-- describes the video in their own words (the prompt); Claude plans the edit.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'inspo'
  CHECK (kind IN ('inspo', 'scratch'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prompt TEXT;
