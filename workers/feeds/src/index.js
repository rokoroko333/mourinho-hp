// Cron Worker: refreshes news and match data into the shared KV namespace.
// The Pages site only reads from KV, so visitors never wait on (or break because of) Google News or ESPN.
import { refreshAll } from '../../../lib/feeds.js';

export default {
  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime);
    ctx.waitUntil(refreshAll(env.FEEDS, now).then((r) => console.log(JSON.stringify(r))));
  },

  // Manual trigger for debugging (refreshes the news and the matches): GET /refresh with header "Authorization: Bearer <REFRESH_TOKEN>".
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/refresh') return new Response('Not found', { status: 404 });
    if (!env.REFRESH_TOKEN || !(await sameSecret(request.headers.get('Authorization') || '', `Bearer ${env.REFRESH_TOKEN}`))) {
      return new Response('Unauthorized', { status: 401 });
    }
    return Response.json(await refreshAll(env.FEEDS));
  },
};

// Constant-time comparison, so response timing does not reveal how much of the token matched.
// Both sides are hashed first because timingSafeEqual needs equal lengths.
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((v) => crypto.subtle.digest('SHA-256', enc.encode(v))));
  return crypto.subtle.timingSafeEqual(x, y);
}
