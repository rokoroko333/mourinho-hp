// Serves cached feed JSON from KV for the Pages Functions.
// Order: edge cache (per colo, 5 min) -> KV (written by the cron Worker) -> live fetch (only if KV is empty).

const EDGE_TTL = 300;

export async function serveCached(context, { key, live }) {
  const { request, env, waitUntil } = context;
  const cache = caches.default;
  // Key on the path plus the known `lang` param only, so random query strings cannot bypass the cache.
  const url = new URL(request.url);
  const lang = url.searchParams.get('lang');
  const cacheKey = new Request(`${url.origin}${url.pathname}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`, {
    method: 'GET',
  });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let body = null;
  try {
    body = env.FEEDS ? await env.FEEDS.get(key) : null;
  } catch {
    // KV unavailable (e.g. free-plan limit reached): fall through to the live fetch.
  }
  if (!body) {
    try {
      const data = await live();
      body = JSON.stringify({ updatedAt: new Date().toISOString(), ...data });
      // Seed KV so the next colo does not hit upstream too (first deploy, or cron not set up yet).
      if (env.FEEDS && hasContent(data)) waitUntil(env.FEEDS.put(key, body).catch(() => {}));
    } catch (err) {
      return json({ error: 'unavailable' }, 503, 30);
    }
  }

  const res = json(body, 200, EDGE_TTL);
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function hasContent(data) {
  return Boolean(data.items?.length || data.latest || data.next);
}

function json(body, status, maxAge) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=60, s-maxage=${maxAge}`,
    },
  });
}
