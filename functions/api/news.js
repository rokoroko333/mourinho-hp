import { LANGS, KV_KEYS, fetchNews } from '../../lib/feeds.js';
import { serveCached } from '../../lib/serve.js';

export function onRequestGet(context) {
  const lang = new URL(context.request.url).searchParams.get('lang');
  if (!LANGS.includes(lang)) return new Response('Bad lang', { status: 400 });
  // Every language reads the same list (Madrid and Portuguese press, lib/feeds.js); `lang` is still checked
  // so the edge cache keeps one entry per page language rather than one per arbitrary query string.
  return serveCached(context, {
    key: KV_KEYS.news,
    live: async () => ({ items: await fetchNews() }),
  });
}
