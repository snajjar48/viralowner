-- People testing ViralOwner for free (admin dashboard › testers): an account signed up with one of
-- these emails gets full access with no plan, trial or card, like the owner. Removing the email
-- takes it away again.
CREATE TABLE IF NOT EXISTS testers (
  email      TEXT PRIMARY KEY,
  note       TEXT NOT NULL DEFAULT '',
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
