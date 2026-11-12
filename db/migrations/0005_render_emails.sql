-- When we emailed the user that this version finished (or failed), so each
-- outcome is emailed once. Cleared when a failed version is tried again.
ALTER TABLE renders ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;
