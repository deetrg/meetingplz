/* MeetingPlz service worker: Web Push reminders. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
