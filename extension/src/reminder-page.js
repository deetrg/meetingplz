/* Fallback reminder window (used when the active tab can't be scripted). */
(function () {
  function send(type, ev) { try { chrome.runtime.sendMessage({ type: type, event: ev }); } catch (e) {} }
  chrome.runtime.sendMessage({ type: 'getCurrent' }, function (p) {
    if (!p || !p.event) { window.close(); return; }
    var inst = MeetingPlzReminder.show({
      event: p.event, settings: p.settings, mode: 'takeover', isPrimary: true,
      onJoin: function () { send('join', p.event); inst.close(); setTimeout(function () { window.close(); }, 100); },
      onSnooze: function () { send('snooze', p.event); inst.close(); setTimeout(function () { window.close(); }, 100); },
      onDismiss: function () { send('dismiss', p.event); inst.close(); setTimeout(function () { window.close(); }, 100); },
      onPointerInCard: function () {}
    });
  });
})();
