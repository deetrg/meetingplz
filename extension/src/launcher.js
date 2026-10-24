/* Injected into a web page right after reminder.iife.js (isolated world). Payload comes from globalThis.__mpzPayload. */
(function () {
  var p = globalThis.__mpzPayload;
  try { delete globalThis.__mpzPayload; } catch (e) { globalThis.__mpzPayload = undefined; }
  if (!p || !globalThis.MeetingPlzReminder) return;
  if (globalThis.__mpzInstance) { try { globalThis.__mpzInstance.close(); } catch (e) {} globalThis.__mpzInstance = null; }
  function send(type) {
    try { chrome.runtime.sendMessage({ type: type, event: p.event }); } catch (e) {}
  }
  function done() { var i = globalThis.__mpzInstance; globalThis.__mpzInstance = null; try { i && i.close(); } catch (e) {} }
  globalThis.__mpzInstance = globalThis.MeetingPlzReminder.show({
    event: p.event,
    settings: p.settings,
    mode: p.mode,
    isPrimary: true,
    onJoin: function () { send('join'); done(); },
    onSnooze: function () { send('snooze'); done(); },
    onDismiss: function () { send('dismiss'); done(); },
    onPointerInCard: function () {}
  });
})();
