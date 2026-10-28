import { LANGS, KV_KEYS, fetchNews } from '../../lib/feeds.js';
import { serveCached } from '../../lib/serve.js';

export function onRequestGet(context) {
  const lang = new URL(context.request.url).searchParams.get('lang');
  if (!LANGS.includes(lang)) return new Response('Bad lang', { status: 400 });
  return serveCached(context, {
    key: KV_KEYS.news(lang),
    live: async () => ({ items: await fetchNews(lang) }),
  });
}
