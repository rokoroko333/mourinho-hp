import { KV_KEYS, fetchMatches } from '../../lib/feeds.js';
import { serveCached } from '../../lib/serve.js';

export function onRequestGet(context) {
  return serveCached(context, { key: KV_KEYS.matches, live: () => fetchMatches() });
}
