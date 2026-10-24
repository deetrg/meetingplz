CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  picture TEXT,
  refresh_token_enc TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  ua TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subs_user ON push_subs(user_id);
CREATE TABLE events_cache (
  user_id TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE fired (
  user_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  fired_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_key)
);
CREATE TABLE snoozes (
  user_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_key)
);
