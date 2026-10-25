-- Multiple Google accounts per MeetingPlz user. users.google_sub / email stay as the primary account's identity.
CREATE TABLE google_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  picture TEXT,
  refresh_token_enc TEXT,
  added_at INTEGER NOT NULL,
  last_error TEXT
);
CREATE INDEX google_accounts_user ON google_accounts(user_id);
INSERT INTO google_accounts (id, user_id, google_sub, email, name, picture, refresh_token_enc, added_at, last_error)
  SELECT lower(hex(randomblob(16))), id, google_sub, email, name, picture, refresh_token_enc, created_at, NULL FROM users;
