// meetingplz.pages.dev keeps serving /api/* (older desktop, extension and iOS builds call it);
// every HTML page there moves to the canonical domain.
export const CANONICAL = 'https://meetingplz.nonolingo.com';
const LEGACY_HOST = 'meetingplz.pages.dev';

export function legacyRedirect(requestUrl) {
  const url = new URL(requestUrl);
  if (url.hostname !== LEGACY_HOST) return null;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  return new Response(null, { status: 301, headers: { location: CANONICAL + url.pathname + url.search, 'cache-control': 'public, max-age=300' } });
}
