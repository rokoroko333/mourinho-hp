// Everything a page's live sections need in one request: the shared news list, the matches, and the fan
// prediction tallies for the next and the latest match. Each Function invocation counts toward the free
// plan's 100,000 a day even when the edge cache answers, so the pages make one call instead of three.
// The whole answer is cached per colo for SUMMARY_TTL (the tallies' freshness), keyed on the checked `lang` only.
// /api/news, /api/matches and GET /api/predict stay for app.js cached from the previous deploy.
import { LANGS, KV_KEYS, fetchNews, fetchMatches } from '../../lib/feeds.js';
import { SUMMARY_TTL, cachedSummary } from '../../lib/predict.js';
import { json, readFeed } from '../../lib/serve.js';

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const lang = url.searchParams.get('lang');
  if (!LANGS.includes(lang)) return json({ error: 'bad lang' }, 400);
  const cacheKey = new Request(`${url.origin}${url.pathname}?lang=${lang}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;

  const [newsText, matchesText] = await Promise.all([
    readFeed(context, { key: KV_KEYS.news, live: async () => ({ items: await fetchNews() }) }),
    readFeed(context, { key: KV_KEYS.matches, live: () => fetchMatches() }),
  ]);
  const parse = (text) => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  };
  const news = parse(newsText);
  const matches = parse(matchesText);
  // A failed tally (D1 down or over quota) leaves that match out; the news and matches still go out.
  const predict = {};
  if (env.VOTES && matches) {
    for (const m of [matches.next, matches.latest]) {
      if (!m?.id || !/^\d{1,12}$/.test(String(m.id))) continue;
      try {
        const s = await cachedSummary(context, matches, String(m.id));
        if (s) predict[m.id] = s;
      } catch {}
    }
  }
  if (!news && !matches) return json({ error: 'unavailable' }, 503);
  const res = json({ news, matches, predict }, 200, SUMMARY_TTL, SUMMARY_TTL);
  if (news && matches) waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}
