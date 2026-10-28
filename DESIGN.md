# MeetingPlz design v2 — "Final call"

Goal (owner, 2026-10-28): unslop the UI/UX, make it 10x more beautiful, on every surface. Keep it dead simple to use. This file is the single source of truth; every client implements these tokens and components.

## 1. What is wrong today (audit)

- Everything is the same black pill with a 2 px black outline. No hierarchy between primary, secondary, tertiary.
- System font everywhere at similar sizes. Headlines have no character; numbers (times, countdown) are proportional.
- Centered, symmetric layouts; boxes inside boxes (bordered card containing bordered rows).
- Pure white / pure near-black surfaces, no texture, no warmth. Dark screenshots read harsh.
- The plane is the only brand idea, and it only appears in the reminder. The rest looks like a template.
- Generic Google button, generic empty states ("No meetings coming up."), generic settings lists.

## 2. Concept

**Your meeting is a flight.** The reminder is a boarding pass, the meeting list is a departures board, being late is "Final call". The line-art plane already carries the banner; v2 makes the whole product speak the same language, quietly. Words stay plain and clear (a first-time user must understand "Join on Meet" instantly); the airport flavour lives in labels, layout and small details, never in jokes that hide meaning.

## 3. Tokens

Light (default):
- `--paper` #F3EFE6 (warm bone, page background)
- `--surface` #FBF9F4 (cards, pass)
- `--ink` #171512 (text, primary button)
- `--ink-2` #3A3631 (secondary text strong)
- `--muted` #7A746A (labels, meta)
- `--line` rgba(23,21,18,.12) (hairlines)
- `--line-strong` rgba(23,21,18,.22)
- `--accent` #D4512A (signal orange; the ONLY colour; used for: late state, live/boarding dot, hold-to-close progress, focus ring, active segment underline, the plane's small tail stripe)
- `--accent-soft` rgba(212,81,42,.10)
- `--ok` uses ink, never green.

Dark:
- `--paper` #13120F, `--surface` #1C1A17, `--ink` #F1EDE4, `--ink-2` #CFC9BE, `--muted` #958F84, `--line` rgba(241,237,228,.12), `--line-strong` rgba(241,237,228,.22), `--accent` #EE6A40, `--accent-soft` rgba(238,106,64,.14).

Type (bundle font files, never load from Google at runtime):
- Display serif: **Instrument Serif** (OFL; regular + italic). Headlines, meeting titles in the pass, wordmark. Tracking -0.01em, line-height 1.02. Italic used for one emphasised word per headline at most (e.g. "Never forget a meeting *again*.").
- UI sans: system stack `-apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`. Body 15–16 px / 1.5. Weights 400/500/600 only.
- Mono: **Geist Mono** (OFL; 400/500). Times, countdown, labels. Labels: 11 px, uppercase, letter-spacing .09em, `--muted`. All numbers tabular.
- Wordmark: "Meeting" Instrument Serif regular + "Plz" Instrument Serif italic, followed by a small accent dot.

Scale: 11 / 13 / 15 / 17 / 22 / 30 / 44 / 64 / 96. Spacing 4-pt grid: 4 8 12 16 24 32 48 72 112.
Radius: 6 (chips, inputs), 12 (buttons), 18 (pass, cards), 28 (phone frames). No pills except tiny status dots.
Elevation: none on the page. The floating pass (fly-by) gets `0 30px 80px -20px rgba(23,21,18,.45), 0 0 0 1px var(--line)` (dark: stronger, black-tinted).
Texture: a fixed paper-grain layer (SVG feTurbulence, 3.5% opacity, multiply) on site, web app, settings windows, popup. Not inside the reminder pass.
Motion: `cubic-bezier(.16,1,.3,1)` 500–700 ms for entries; hover 160 ms; press `scale(.98)`; all motion behind `prefers-reduced-motion: no-preference`.

## 4. Components

**Primary button**: ink background, paper text, radius 12, height 52 (48 in compact), label sans 600 16 px, trailing arrow glyph "→" that nudges 3 px right on hover. Hover: background `--ink-2`. Focus: 2 px accent ring offset 2. Disabled: 40% opacity.
**Secondary**: no box; label sans 500 + 1 px underline offset 4 on hover. Used for "I'm in", "Snooze 1 min", "Sign out".
**Segmented control** (lead time, style, alarm): mono 12 px labels in a row separated by hairlines; selected item = ink text + 2 px accent underline; unselected = muted. No pill backgrounds.
**Row** (settings, lists): label left (sans 500), value right (mono or sans muted), hairline between rows, 52 px tall, no outer box.
**Status chip**: mono 10.5 px uppercase with a 6 px dot: `ON TIME` (dot ink), `BOARDING` (dot accent, pulsing 2 s), `FINAL CALL` (accent text). Square-ish radius 6, 1 px line border.
**Google button**: follow Google's sign-in branding (white surface, 1 px #747775 border, official 4-colour G, "Continue with Google", radius 12 to match our buttons). Dark mode: #131314 surface, #8E918F border, white text.
**Empty state**: small line-art scene (plane over two clouds) + serif line "Clear skies." + sans sub "No meetings in the next 24 hours."

## 5. The reminder ("boarding pass")

Same component for fly-by card, takeover, iPhone full-screen, extension fallback window.
- Pass: surface, radius 18, width min(560px, 92vw). Two parts split by a perforation: a dashed hairline with two 18 px half-circle notches cut at both edges (CSS mask or SVG).
- Top part (padding 28 32):
  - Row of mono labels: `MEETINGPLZ · BOARDING PASS` left (muted), status chip right (`BOARDING` while before start; `FINAL CALL` after start).
  - Headline serif 44 px: "Your meeting is boarding." (late: "Final call.") — the headline letters still drop from the plane in fly-by.
  - Meeting title serif 30 px, 2 lines max, ellipsis.
  - A 3-column info grid with mono labels above values: `DEPARTS` 10:00 → 10:30 · `GATE` Google Meet / Zoom / Teams / — · `WITH` Miles +3. Then `FROM` you@work.com on its own line (muted mono 12).
- Bottom part (padding 24 32 28): left = `BOARDS IN` label + countdown mono 56 px `01:58` (late: `LATE BY` + accent `02:14`); right = primary button "Join on Meet →" (no link: "Got it →"). Under it a row of secondary actions: "I'm in" · "Snooze 1 min" · "Hold to close" (hold shows an accent progress underline filling over 2 s).
- Fly-by: transparent page; plane (refined line art, 1.75 stroke, accent tail stripe) crosses at 16% height pulling the banner; banner tiles become little split-flap tiles (surface bg, ink mono letters, hairline middle split). Pass rises (translateY 24 → 0, opacity) under the dropping letters. Soft shadow as above.
- Takeover: full-screen `--paper` with grain; the pass centred; a faint departures board in the background (3–4 rows of other meetings in muted mono, 6% opacity) for depth; plane passes once along the top.
- Mobile (≤ 480 px): pass full width minus 16 px, info grid 2 columns, button full width under the countdown.
- Copy: sub line under headline removed (the pass says it); live text goes into the countdown label. Keep Enter = join, no Escape in takeover.

## 6. Surfaces

**Website (/)**: left-aligned hero on paper with grain. Wordmark top-left, links right (`Download`, `Sign in`). H1 serif 96/64 px: "Never forget a meeting *again*." Sub sans 19 px max 520 px: "Two minutes before every meeting, a plane flies across your screen with one button: Join." Buttons: primary "Download for Mac →" (auto-detects Windows → "Download for Windows →"), secondary "Use it in the browser". Below: a faux desktop window (hairline frame, no heavy chrome) playing the real fly-by in a loop (use the reminder component with a scripted clock) — replaces the video on desktop; keep the video on mobile. Then a "Departures" strip: a 4-row board (mono) with live-looking statuses (ON TIME / BOARDING / FINAL CALL) explaining features in one line each: "Every Google account, one board." · "Only real meetings ring." · "30 seconds to 10 minutes, your call." · "Free on Mac, Windows, iPhone and Chrome." Then the platform row as four small boarding-pass tickets (platform glyph, name, `DOWNLOAD →`). Footer one line. Privacy/terms/chrome/iphone/404 pages get the same type and paper.
**Web app (/app)**: signed out = centered narrow column: wordmark, serif "Your meetings, on time." + Google button + "Try it without signing in" text link (demo mode with sample meetings, same as iOS). Signed in = header (wordmark, account avatar menu), big "Next up" departures board (time mono | title serif 20 | gate | status chip), "Test it →" primary, settings as rows + segmented controls, Accounts as passport-stamp chips (email in mono inside a 1 px dashed rounded rect, × to remove), notifications row, platforms row. Dark mode follows system.
**Desktop settings window, Chrome popup, onboarding**: same tokens and components, compact density (rows 44 px). Popup 360 px wide: wordmark, next meeting as a mini pass (title serif, mono time, status chip, Join →), segmented quick settings, Test it, footer links.
**iOS**: SwiftUI port of the tokens (Color assets light/dark, bundled Instrument Serif + Geist Mono via `UIAppFonts`), same pass for the full-screen reminder, departures-board home, rows settings, Google button per branding, empty state, demo banner restyled as a thin mono strip.
**App icon**: keep the ink rounded square + paper line-art plane; add the small accent tail stripe. Regenerate all sizes.

## 7. Rules

- One accent colour. No gradients except the grain and the fly-by shadow. No emoji. Sentence case.
- Every screen in light and dark. Check 1440×900, 1280×800, 390×844.
- Never break functionality; all existing tests must pass; add visual QA screenshots for every surface under `tmp/v2qa/` in the session folder.
