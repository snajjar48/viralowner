-- The "create a video" flow: a project holds one inspo video, the user's
-- clips, and every render (version) of the finished edit.
-- Rows are owned by a Supabase auth user (projects.user_id); every query in
-- src/lib/projects.ts filters by it.

CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'analyzing', 'ready_for_clips', 'processing', 'done', 'failed')),
  -- Step 3 options (on-screen text, music, captions). See src/lib/video-options.ts.
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  clips_rights_confirmed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_user_created_idx ON projects (user_id, created_at DESC);

-- One inspo per project (uploading a new one replaces it).
CREATE TABLE inspirations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE,
  storage_key     TEXT NOT NULL,
  file_name       TEXT,
  content_type    TEXT,
  size_bytes      BIGINT,
  duration_s      NUMERIC(7, 2),
  breakdown_json  JSONB,
  status          TEXT NOT NULL DEFAULT 'uploading'
                  CHECK (status IN ('uploading', 'uploaded', 'analyzing', 'ready', 'failed')),
  error           TEXT,
  style_reference_confirmed_at TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  file_name     TEXT,
  content_type  TEXT,
  size_bytes    BIGINT,
  duration_s    NUMERIC(7, 2),
  position      INTEGER NOT NULL,
  -- Which shot of the breakdown this clip is assigned to (0-based), if any.
  shot_index    INTEGER CHECK (shot_index IS NULL OR shot_index >= 0),
  status        TEXT NOT NULL DEFAULT 'uploading'
                CHECK (status IN ('uploading', 'uploaded', 'failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX clips_project_position_idx ON clips (project_id, position);

CREATE TABLE renders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  -- The processing engine's job id (src/lib/processing).
  job_id        TEXT,
  storage_key   TEXT,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  stage         TEXT CHECK (stage IS NULL OR stage IN ('analyzing', 'matching', 'editing', 'finishing')),
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  -- Exactly what this version was made from (options, clip-per-shot, trims).
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Engine output extras, e.g. the suggested caption and hashtags.
  result_json   JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (project_id, version)
)
