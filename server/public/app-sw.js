/* MeetingPlz service worker: Web Push reminders. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Local-only receipt log (Cache Storage, last 20) so a push can be verified from the page: caches.open('mp-push-log').
async function logPush(entry) {
  try {
    const c = await caches.open('mp-push-log');
    await c.put('/__push/' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), new Response(JSON.stringify(entry)));
    const keys = await c.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - 20))) await c.delete(k);
  } catch { /* ignore */ }
}

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Join the meeting.', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
    const isTest = !!(d.data && d.data.test);
    // The open app tab shows the in-page reminder itself; don't double up (never on iOS, which needs a notification per push).
    if (!ios && !isTest && wins.some((w) => w.visibilityState === 'visible')) {
      wins.forEach((w) => w.postMessage({ type: 'push', data: d.data }));
      await logPush({ at: Date.now(), title: d.title, body: d.body, shown: false, via: 'in-page' });
      return;
    }
    await self.registration.showNotification(d.title || 'Join the meeting.', {
      body: d.body || '',
      tag: d.tag || 'meetingplz',
      data: d.data || {},
      actions: d.actions || [],
      requireInteraction: true,
      icon: '/shared/art/icon-192.png',
      badge: '/shared/art/icon-32.png',
    });
    await logPush({ at: Date.now(), title: d.title, body: d.body, tag: d.tag, actions: (d.actions || []).map((a) => a.title), shown: true });
  })());
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();
  event.waitUntil((async () => {
    if (event.action === 'snooze') {
      if (data.key) {
        await fetch('/api/snooze', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: data.key, seconds: 60 }),
        }).catch(() => {});
      }
      return;
    }
    const url = data.url || '/app';
    if (url.startsWith('/')) {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const app = wins.find((w) => new URL(w.url).pathname.startsWith('/app'));
      if (app) return app.focus();
    }
    return self.clients.openWindow(url);
  })());
});
