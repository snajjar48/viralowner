-- Where each waitlist signup came from: the page and any ad tags in its link
-- (e.g. "start | utm_source=meta | utm_campaign=cafes").
ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
