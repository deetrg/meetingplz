-- First-party anonymous funnel counters: one row per UTC day x event x client x campaign tag. No user id, no IP, no cookie.
CREATE TABLE metrics (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  ref TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, client, ref)
);
-- Campaign tag a user signed up from, and the one-time "first meetings loaded" marker for the activation count.
ALTER TABLE users ADD COLUMN ref TEXT;
ALTER TABLE users ADD COLUMN first_upcoming_at INTEGER;
-- Existing users are already activated: do not count them as new first_upcoming events.
UPDATE users SET first_upcoming_at = created_at WHERE first_upcoming_at IS NULL;
