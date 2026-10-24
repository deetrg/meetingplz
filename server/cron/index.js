import { runCron } from '../src/notify.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, event.scheduledTime || Date.now()));
  },
  // GET / for a quick health check (no data returned)
  async fetch() {
    return new Response('meetingplz-cron ok', { status: 200 });
  },
};
