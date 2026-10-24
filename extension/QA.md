# Real Chrome QA (unpacked)

Build: `cd extension && npm test && npm run build` (or download `meetingplz-extension.zip` from the v1.0.0 release and unzip).

## Load
1. Open `chrome://extensions`, switch on **Developer mode** (top right).
2. **Load unpacked** and pick `extension/dist/unpacked`.
3. Confirm the id is `afkodmbjfhhmcmihogbkdpknlogjhpfp` and no errors show on the card. Pin the extension.

## Checklist
- [ ] Popup signed out: plane illustration, `MeetingPlz.`, **Continue with Google**.
- [ ] Continue with Google opens the Google consent window; after approval the popup shows the signed-in view (email top right). Calendar read-only is requested.
- [ ] Signed in: next meeting card (title, time range, "in N minutes", Join button when it has a link) or the "No meetings coming up" state.
- [ ] Toolbar badge shows minutes to the next meeting when it is 60 min or less, empty otherwise.
- [ ] **Test it** on a normal site (e.g. wikipedia.org): after about 2 s the flyby plane crosses and the card appears over the page; page behind stays clickable in flyby.
- [ ] Switch Style to Takeover, Test it again: full-screen white card, nothing else usable.
- [ ] Test it with the active tab on `chrome://extensions` and on the Chrome Web Store: a small popup window opens with the reminder.
- [ ] Test it with Chrome in the background (click another app first, then trigger from a real meeting): popup window shows, plus a system notification.
- [ ] Join opens the meeting link in a new tab and closes the reminder and notification.
- [ ] Snooze 1 min closes the reminder and it comes back about 60 s later.
- [ ] Hold to close dismisses without reopening.
- [ ] Lead time and Alarm selects save (reload the popup, values persist; also visible in the web app).
- [ ] Real meeting: create a Google Calendar event with a Meet link 3 minutes ahead; the reminder fires once at the lead time and not again on later ticks.
- [ ] Sign out returns to the signed-out popup and clears the badge.
- [ ] Debug: `chrome://extensions` > MeetingPlz > **service worker** shows the console; alarms tick every minute.
