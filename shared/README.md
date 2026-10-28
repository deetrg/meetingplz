# shared/

Used by every client. No dependencies, no build step needed to consume.

- `core.js` (UMD): pure helpers. Browser global `MeetingPlzCore`, Node `require('./core.js')`.
- `reminder/reminder.js` (ES module) and `reminder/reminder.iife.js` (global `MeetingPlzReminder`): the reminder UI.
- `design/` (design v2, see DESIGN.md): `tokens.css` (all CSS variables, light + dark via `prefers-color-scheme`, force with `<html data-theme="light|dark">`), `components.css` (buttons, segmented control, rows, status chip, Google button, empty state, wordmark, grain layer, focus ring), `fonts/` (Instrument Serif regular + italic, Geist Mono 400/500, Latin subset woff2 + OFL licences) and `fonts.js` (generated; registers the fonts as `MPZ Serif` / `MPZ Mono` with the FontFace API from base64, because `@font-face` does not work inside a shadow root).
- `art/`: line-art SVGs (`plane` 1.75 stroke with the accent tail stripe, `clouds` empty state, `tile`, `person-laptop`, `calendar-check`, `icon`, `icon-paper`) and PNG icons (`icon-1024/512/192/180/32.png`, `icon-paper-1024.png`).
- `demo.html`: QA page. Serve `shared/` with any static server (e.g. `npx http-server shared`) and open `/demo.html`.
- `build.js`: `node shared/build.js [--png]` regenerates `design/fonts.js`, `reminder.iife.js` (fonts.js is prepended, so the IIFE is self-contained), `art/plane.svg`, `art/clouds.svg`, icon SVGs (and PNGs with `--png`, needs `sharp`). Run it after editing `reminder.js`; `npm test` equivalent: `node --test shared/test/core.test.js` (fails if the IIFE is stale).

## How clients include it

Copy or reference by relative path, no packaging:

- Web app (Pages): copy `core.js`, `reminder/reminder.iife.js`, `art/` into the served folder (e.g. `server/public/shared/`), then `<script src="/shared/core.js">` and `<script src="/shared/reminder.iife.js">`. Or `import { show } from '/shared/reminder.js'`.
- Pages and web app: also copy `design/` (the server build does it) and link `tokens.css` + `components.css`; add class `grain` to `<body>` for the paper grain.
- Chrome extension: copy `core.js` (background, via `importScripts` or bundle) and `reminder.iife.js` (injected with `scripting.executeScript({ files: [...] })`, then call `MeetingPlzReminder.show(...)` in a second `func` injection in the same world), plus `art/icon-*.png`.
- Desktop (Tauri): load `reminder.iife.js` in the overlay window HTML.
- iOS: reuse `art/*.svg` and `icon-1024.png`; port the card design natively.

## core.js

Events may use `start`/`end` as epoch ms, ISO strings, or Google `{dateTime|date}`.

- `isMeeting(evt)` true if: has a call link (`link`, `hangoutLink`, conferenceData, or a Zoom/Meet/Teams/Webex link in location/description), or another guest (`attendees` array with someone not `self`, or `attendeeCount > 1`), or organizer is someone else. False for all-day, `declined`, `status: 'cancelled'`, `eventType` other than `default`, solo blocks.
- `pickDue(events, now, settings, firedKeys)` returns due events sorted by start: `start - leadSeconds*1000 <= now < start + 10 min`, not in `firedKeys` (Set, array or object), skips all-day/declined/cancelled, and non-meetings when `meetingsOnly`. Pure: the caller must add `eventKey(evt)` (= `evt.key`) to its fired set.
- `inText(ms)` -> `in 2 minutes` | `in 1 minute` | `in 45 seconds` | `now`.
- `bannerText(title, ms)` -> `QUICK SYNC · IN 2 MIN`, max 26 chars, ellipsis on the title.
- `providerLabel(link)` -> `Join on Meet` | `Join Zoom` | `Join on Teams` | `Join Webex` | `Join` (other link) | `Got it` (no link).
- `providerOf(link)` -> `meet|zoom|teams|webex|other|''`. `extractMeetingLink(texts)` -> best link or `''`.
- `fmtClock(ms)` -> `1:58` (counting down); negative -> `0:42` (seconds late).
- `DEFAULT_SETTINGS` = `{ leadSeconds: 120, style: 'flyby', alarm: 'jingle', meetingsOnly: true, snoozeSeconds: 60 }`.
- `validateSettings(partial)` returns only the valid keys of `partial` (safe to merge over stored settings; use for `PUT /api/settings`). `normalizeSettings(x)` returns a full settings object with defaults filled in.
- Boarding-pass copy (design v2): `headline(ms)` -> `Your meeting is boarding.` | `Final call.`; `statusText(ms)` -> `BOARDING` | `FINAL CALL`; `clockLabel(ms)` -> `BOARDS IN` | `LATE BY`; `padClock('1:58')` -> `01:58`; `gateLabel(link)` -> `Google Meet|Zoom|Teams|Webex|Link|—`; `withText('with Miles and 3 others')` -> `Miles +3`.
- Also: `eventKey`, `toMs`, `LEAD_OPTIONS`, `STYLE_OPTIONS`, `ALARM_OPTIONS`.

## Reminder (the boarding pass)

```js
const r = MeetingPlzReminder.show({
  event: { key, title, start, end, link, calendar, attendees },  // /api/upcoming shape
  settings: { alarm: 'jingle', snoozeSeconds: 60, style: 'flyby' },
  mode: 'flyby',            // or 'takeover' (default: settings.style)
  isPrimary: true,          // false on secondary displays: no alarm sound
  onJoin(evt) {},           // if omitted, opens evt.link in a new tab
  onSnooze(evt, seconds) {},
  onDismiss(evt, reason) {},      // reason: 'imin' | 'hold'
  onPointerInCard(inside) {}      // flyby only; use for OS click-through
});
r.update(newEvent); r.close();
```

- Same API and callbacks as v1. Every action (Join, I'm in, Snooze, Hold to close) calls its callback, stops the alarm, and closes the reminder. `r.close()` closes without callbacks.
- The pass (DESIGN.md section 5): `MEETINGPLZ · BOARDING PASS` label + status chip (`BOARDING` / `FINAL CALL`), serif headline (`Your meeting is boarding.` / `Final call.`), serif meeting title, DEPARTS / GATE / WITH grid, `FROM` account, perforation with two notches, then `BOARDS IN` / `LATE BY` countdown (mono, `01:58`) and the Join button (`Join on Meet →`, `Got it →` without a link) with `I'm in`, `Snooze 1 min`, `Hold to close` (accent progress underline over 2 s).
- Host is `<meetingplz-reminder>` appended to `<html>`, closed shadow root, `z-index: 2147483647`. Flyby host is `pointer-events: none` except the pass. Calling `show` again with the same `event.key` replaces the earlier one.
- Flyby: plane (1.75 stroke, accent tail) crosses at 16% height pulling a split-flap banner, the headline letters drop into the pass, the pass rises under them, another pass of the plane every 45 s. Takeover: `--paper` full screen with grain and a faint departures board behind the pass, one plane pass along the top, Enter = Join (global), no Escape. Flyby: Enter works when the pass has focus.
- Mobile (container width <= 480 px): pass is the full width minus 16 px, info grid is 2 columns, button full width under the countdown. All sizes use container query units, so the same component also works inside a box (see `container`).
- Alarm: WebAudio, plays on show and every 6 s while open. Browsers may keep audio suspended until the first user gesture on that page; it resumes on the first click/key.
- Honors `prefers-reduced-motion` (no plane, fade only) and `prefers-color-scheme: dark`.
- Extra options: `theme` (`'auto'|'light'|'dark'`), `now()` (clock override), `container` (an element: the reminder fills it instead of the viewport, used by the website's live demo), `upcoming` (events for the takeover backdrop), `volume` (0..1), `globalEnter`, `freezeAt` (ms, QA screenshots only).
- `MeetingPlzReminder.playAlarm(kind)` plays one burst (`jingle|buzz|bell|beep`) for settings previews.
- QA: serve `shared/` and open `demo.html#kind=flyby|flyby-late|takeover|takeover-late&freeze=5200&theme=light|dark`.
