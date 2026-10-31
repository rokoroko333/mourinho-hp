// Cron Worker: refreshes news and match data into the shared KV namespace.
// The Pages site only reads from KV, so visitors never wait on (or break because of) Google News or ESPN.
import { refreshAll } from '../../../lib/feeds.js';
import { purge } from '../../../lib/predict.js';

export default {
  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime);
    ctx.waitUntil(refreshAll(env.FEEDS, now).then((r) => console.log(JSON.stringify(r))));
    // Fan predictions: individual votes go 30 days after kick-off; the tallies stay (lib/predict.js).
    if (env.VOTES) ctx.waitUntil(purge(env.VOTES, now.getTime()).then((r) => console.log(JSON.stringify({ predictions: r })), (e) => console.log(JSON.stringify({ predictions: `error: ${e.message}` }))));
  },
};
