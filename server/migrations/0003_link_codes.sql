-- One-time codes for linking a Google account from non-web clients (extension, desktop, iOS).
CREATE TABLE link_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  email TEXT,
  name TEXT,
  picture TEXT,
  refresh_token_enc TEXT,
  expires_at INTEGER NOT NULL
);
