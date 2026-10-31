# MeetingPlz server

Cloudflare, free plan. No KV.

- **Pages project `meetingplz`** (canonical https://meetingplz.nonolingo.com, custom domain, CNAME `meetingplz` -> `meetingplz.pages.dev` proxied; https://meetingplz.pages.dev still serves `/api/*` for older desktop/extension/iOS builds and 301s every HTML page to the canonical domain via `functions/_middleware.js`): marketing site (`/`, `/privacy`, `/terms`, `/chrome`, `/iphone`), the web app (`/app`, PWA) and Pages Functions under `/api/*`.
- **D1 `meetingplz-db`**: `users`, `google_accounts`, `sessions`, `push_subs`, `events_cache`, `fired`, `snoozes`, `link_codes` (`migrations/`). `google_accounts` holds every linked Google account (token, email) per user; `users.google_sub`/`email` are the primary account.
- **Worker `meetingplz-cron`** (cron `* * * * *`): Web Push reminders, VAPID + aes128gcm on Web Crypto only.

```
server/
  public/              static site + web app (index, app.html, assets/, app-sw.js, manifest)
  partials/            header/footer/download row injected into public/*.html at build time
  functions/api/       Pages Function (one catch-all -> src/api.js)
  src/                 api.js, google.js, events.js, notify.js, push.js, crypto.js, util.js
  src/vendor/core.cjs  copy of shared/core.js (kept in sync by scripts/build.mjs)
  cron/                Worker entry + wrangler.toml
  migrations/          D1 SQL
  scripts/build.mjs    public/ + shared/ (core, reminder, art, design) -> dist/ (copy, no symlinks); fills <!--HEAD-->, <!--HEADER-->, <!--FOOTER-->, <!--DOWNLOADS--> and <!--ART:clouds|plane|calendar-check--> from partials and shared/art
  test/                node --test (real SQL via node:sqlite, mocked fetch)
```

## Tests

```
npm test     # from server/, Node 22+ (uses node:sqlite)
```

## Deploy

Wrangler: `~/.aside/cn-tools/node_modules/.bin/wrangler` (account `b33c5efefc2d59e27f54f67ae7d97f11`).

```
W=~/.aside/cn-tools/node_modules/.bin/wrangler
cd server

# once: database + schema
$W d1 create meetingplz-db
$W d1 migrations apply meetingplz-db --remote

# once: secrets (values come from stdin, never the command line)
for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET TOKEN_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY SESSION_PEPPER; do
  $W pages secret put $k --project-name meetingplz
done
for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET TOKEN_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
  $W secret put $k -c cron/wrangler.toml      # same values as Pages
done

# every release
node scripts/build.mjs
$W pages deploy dist --project-name meetingplz --branch main
$W deploy -c cron/wrangler.toml
```

`TOKEN_KEY` and `SESSION_PEPPER` are 32 random bytes (base64url). `VAPID_PUBLIC_KEY` is the uncompressed P-256 public point (65 bytes, base64url); `VAPID_PRIVATE_KEY` is the JWK `d` of the same key (base64url).

Google OAuth: Web application client "MeetingPlz Web" in GCP project `stop-everything-512408`, redirect URIs `https://meetingplz.nonolingo.com/api/auth/google/callback` (web), `https://meetingplz.pages.dev/api/auth/google/callback` (native clients keep it) and `http://127.0.0.1:8788/api/auth/google/callback` (local: `wrangler pages dev dist --port 8788`, with `PUBLIC_URL=http://127.0.0.1:8788` in `.dev.vars`).

## API

All JSON. Auth is `Authorization: Bearer <session token>` or the `mp_session` cookie (cookie writes must come from the same Origin). CORS allows `chrome-extension://*`, `tauri://localhost`, `http://tauri.localhost`, `capacitor://localhost`, `http://127.0.0.1:*`.

| Endpoint | Notes |
| --- | --- |
| `GET /api/auth/google/start?client=web\|ext\|desktop\|ios&return=<url>` | `return` must be `https://*.chromiumapp.org/*`, `http://127.0.0.1:<port>/*` or `meetingplz://auth`. Web gets a cookie and goes to `/app` (on pages.dev a web start hops to the canonical domain; `scope=calendar` (web only) restarts consent for `calendar.readonly` alone with `include_granted_scopes=true`, used by the "One more step" screen after Google returned without the calendar box ticked); others get `return#token=<token>` (or `return#error=<code>`). |
| `GET /api/me` | `{ email, name, picture, settings, accounts: [{ id, email, picture, primary, error }] }` (`error` is `'reauth'` when that account needs to be linked again) |
| `POST /api/accounts/link` | body `{ client, return }` (same rules as sign-in) -> `{ url }`, a Google URL (account chooser) whose signed state links the chosen account to the caller. Web: the callback attaches the account (needs the cookie session of the same user) and redirects to `/app?linked=1`. Other clients: the callback attaches nothing; it parks the Google tokens under a one-time code (hashed, 5 min) and redirects to `return#link_code=<code>`. Errors as `#error=<code>` (`calendar_access_needed`, `no_refresh_token`, `link_failed`). |
| `POST /api/accounts/link/complete` | `{ code }` with the client's Bearer token; attaches the parked account only if the caller is the user the link was started for (`403 link_failed` otherwise), deletes the code (replay `400 bad_code`, late `400 code_expired`). A Google account that is already a MeetingPlz user with no other accounts is folded into the caller; otherwise `409 account_in_use`. |
| `DELETE /api/accounts/:id` | revokes that account's token and removes it; `400 last_account` for the only one |
| `PUT /api/settings` | validated partial, returns full settings |
| `POST /api/logout` | |
| `POST /api/m` | Anonymous funnel counter, no auth/cookies/IP stored. Body `{name, client, ref}` (JSON or text/plain, for sendBeacon). Names allow-listed: landing_view, download_click_mac\|win\|chrome\|iphone, web_signin_start, demo_start, reminder_shown, test_reminder. 204 (also when rate-limited, 40/min per caller, 600/min per isolate), 400 for other names. Server-side only: signin_ok, user_created, consent_missing, first_upcoming (ref carried in the OAuth state from `/api/auth/google/start?ref=`). Table `metrics(day,name,client,ref,count)`. |
| `GET /stats`, `GET /api/admin/stats` | Private: 404 unless the session user is daitq3010@gmail.com. |
| `GET /api/upcoming` | `{ now, events: [{ key, id, title, start, end, link, provider, calendar, attendees, attendeeCount, isMeeting, allDay, declined }] }`. `now`, `start`, `end` are epoch ms. Merged from every linked account (fetched in parallel; the same meeting in several calendars is listed once, `calendar` = email of the first account). Next 24 h, cached 90 s in D1. A failing account is marked and skipped; `401 reauth` only when no account can be read. `401 {error:"reauth"}` if Google access was revoked. |
| `GET /api/push/vapid` | `{ publicKey }` |
| `POST /api/push/subscribe`, `DELETE /api/push/subscribe` | PushSubscription JSON / `{ endpoint }` |
| `POST /api/test-reminder` | sends a test push to the caller's subscriptions after 5 s |
| `POST /api/snooze` | `{ key, seconds }`, used by the notification Snooze action; the cron re-sends |
| `DELETE /api/me`, `DELETE /api/account` | revokes the Google token and deletes every row for the user |

## Data we keep

Per user: Google refresh token (AES-GCM, key `TOKEN_KEY`), email/name/picture, settings, push subscriptions, and the cached next-24 h event list (titles and times). `fired` and `snoozes` rows are pruned after 2 days. Deleting the account removes all of it.
