-- Inspo analysis runs as a background job on the processing worker.
-- The job id is kept so any request can check on (and finish) the analysis.
ALTER TABLE inspirations ADD COLUMN IF NOT EXISTS analysis_job_id text;
