// Cron Worker: refreshes news and match data into the shared KV namespace.
// The Pages site only reads from KV, so visitors never wait on (or break because of) Google News or ESPN.
import { refreshAll } from '../../../lib/feeds.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshAll(env.FEEDS).then((r) => console.log(JSON.stringify(r))));
  },

  // Manual trigger for debugging: GET /refresh with header "Authorization: Bearer <REFRESH_TOKEN>".
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/refresh') return new Response('Not found', { status: 404 });
    if (!env.REFRESH_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.REFRESH_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    return Response.json(await refreshAll(env.FEEDS));
  },
};
