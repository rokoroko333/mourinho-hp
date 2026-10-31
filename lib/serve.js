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

  const body = await readFeed(context, { key, live });
  if (!body) return json({ error: 'unavailable' }, 503, 30);
  const res = json(body, 200, EDGE_TTL);
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// The JSON text for a KV key, or null. Falls back to a live fetch only when KV is empty or unavailable.
export async function readFeed({ env, waitUntil }, { key, live }) {
  let body = null;
  try {
    body = env.FEEDS ? await env.FEEDS.get(key) : null;
  } catch {
    // KV unavailable (e.g. free-plan limit reached): fall through to the live fetch.
  }
  if (body) return body;
  try {
    const data = await live();
    body = JSON.stringify({ updatedAt: new Date().toISOString(), ...data });
    // Seed KV so the next colo does not hit upstream too (first deploy, or cron not set up yet).
    if (env.FEEDS && hasContent(data)) waitUntil(env.FEEDS.put(key, body).catch(() => {}));
    return body;
  } catch {
    return null;
  }
}

function hasContent(data) {
  return Boolean(data.items?.length || data.latest || data.next);
}

// src/public/_headers does not apply to Function responses, so the JSON carries its own: never sniffed as
// HTML, and a policy that lets nothing load or frame it even if it were opened as a page.
export const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function json(body, status, maxAge, browserMaxAge = 60) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { ...API_HEADERS, 'Cache-Control': maxAge ? `public, max-age=${Math.min(browserMaxAge, maxAge)}, s-maxage=${maxAge}` : 'no-store' },
  });
}
