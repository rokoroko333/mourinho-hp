// Server-side rendering of the /matches/ pages: the Pages Functions under functions/ fill the static page's
// empty fixture and result lists from the KV copy that the cron Worker writes, so the rows are in the HTML
// for search engines. app.js still redraws them in the visitor's own time zone from /api/matches.
// The rows mirror matchRow in src/assets/app.js: change both together.
import { KV_KEYS } from './feeds.js';

const EDGE_TTL = 300;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Times are in the club's time zone (`strings.timeZone`), as app.js shows them; the page says which. Without
// a kick-off time only the day is known, so it is read in UTC rather than shifted by the placeholder time.
export function matchRowsHtml(matches, lang, strings) {
  if (!matches?.length) return `<li class="loading muted">${esc(strings.matchesEmpty)}</li>`;
  const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: strings.timeZone });
  const tbdDayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const timeFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: strings.timeZone });
  return matches
    .map((m) => {
      const d = new Date(m.date);
      const score = m.completed ? `${m.home.score ?? 0} - ${m.away.score ?? 0}` : m.timeTbd ? strings.tbd : timeFmt.format(d);
      return `<li class="match-row"><time datetime="${esc(m.date)}">${esc((m.timeTbd ? tbdDayFmt : dayFmt).format(d))}</time><span class="row-team home">${esc(m.home.name)}</span><strong class="row-score">${esc(score)}</strong><span class="row-team">${esc(m.away.name)}</span><small class="muted">${esc(m.competition)}</small></li>`;
    })
    .join('');
}

// Fills the two lists of a built /matches/ page. The language and strings come from the page itself
// (`data-lang` and the `strings` JSON that app.js reads), so the Functions need no copy of ui.json.
// Returns null when the page does not have the expected markup, so a changed build.mjs is never served
// (and cached) with its "Loading…" placeholder as if it had been filled.
export function fillMatchesPage(html, data) {
  const lang = html.match(/<body data-lang="([a-z]{2})"/)?.[1];
  const json = html.match(/<script type="application\/json" id="strings">([\s\S]*?)<\/script>/)?.[1];
  if (!lang || !json) return null;
  const strings = JSON.parse(json);
  let out = html;
  for (const [id, matches] of [['fixture-list', data.fixtures], ['result-list', data.results]]) {
    const list = new RegExp(`(<ol class="match-rows" id="${id}">)[\\s\\S]*?(</ol>)`);
    if (!list.test(out)) return null;
    out = out.replace(list, (_, open, close) => open + matchRowsHtml(matches, lang, strings) + close);
  }
  return out;
}

// Edge cache (per colo, 5 min) -> static page + KV. When KV has no matches (like hasContent in lib/serve.js),
// the page cannot be filled, or anything fails, the static page is returned as built (app.js fills it as
// before), and that answer is not cached.
export async function serveMatchesPage(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const page = await env.ASSETS.fetch(request);
  if (!page.ok || !(page.headers.get('Content-Type') || '').includes('text/html')) return page;
  let body;
  try {
    body = env.FEEDS ? await env.FEEDS.get(KV_KEYS.matches) : null;
  } catch {
    body = null;
  }
  if (!body) return page;
  let html = null;
  try {
    const data = JSON.parse(body);
    if (data.fixtures?.length || data.results?.length) html = fillMatchesPage(await page.clone().text(), data);
  } catch {
    html = null;
  }
  if (!html) return page;
  const headers = new Headers(page.headers);
  headers.set('Cache-Control', `public, max-age=60, s-maxage=${EDGE_TTL}`);
  headers.delete('Content-Length');
  headers.delete('ETag');
  const res = new Response(html, { status: 200, headers });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
