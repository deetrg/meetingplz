# MeetingPlz Chrome extension (MV3)

Extension id (fixed by manifest `key`): `afkodmbjfhhmcmihogbkdpknlogjhpfp`
OAuth redirect: `https://afkodmbjfhhmcmihogbkdpknlogjhpfp.chromiumapp.org/cb`

Private key (never in git): `~/.appstoreconnect/signing/meetingplz-ext.pem` (chmod 600). Only needed to pack a .crx; the Web Store / unpacked loads use the `key` in the manifest.

## Layout
- `src/` manifest, background service worker, popup, fallback reminder window, launcher (injected after `reminder.iife.js`), icons.
- `stubs/` placeholders used only if `shared/` files are missing at build time.
- `scripts/build.js` copies `src/` + `shared/core.js` + `shared/reminder/reminder.iife.js` + `shared/art/*.svg` into `dist/unpacked`, zips to `dist/meetingplz-extension.zip`.
- `tests/` `node --test` unit tests with mocked `chrome.*`.
- `QA.md` real-Chrome checklist.

## Commands
    cd extension && npm test && npm run build

## How it works
Alarm `mpz-tick` every minute: GET `/api/upcoming` + `/api/me` (Bearer token) -> `core.pickDue` -> inject `reminder.iife.js` + `launcher.js` into the active tab of the last focused normal window (fallback: popup window `reminder.html`), plus a notification with a Join button. Badge = minutes to the next meeting (<= 60). Snooze re-fires after `snoozeSeconds` (60) via a one-shot alarm. 401 signs the user out.
