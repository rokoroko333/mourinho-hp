// Shared feed logic for the cron Worker (workers/feeds) and the Pages Functions (functions/api).
// Everything here runs server-side on Cloudflare; the browser only ever reads our own /api/* JSON.

export const LANGS = ['en', 'es', 'pt'];

// Two Google News editions per language so each audience gets local coverage.
export const NEWS_SOURCES = {
  en: [
    { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
    { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  ],
  es: [
    { hl: 'es', gl: 'ES', ceid: 'ES:es' },
    { hl: 'es-419', gl: 'MX', ceid: 'MX:es-419' },
  ],
  pt: [
    { hl: 'pt-PT', gl: 'PT', ceid: 'PT:pt-150' },
    { hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' },
  ],
};

// Outlets we always want represented, queried with `site:` on the language's first edition above.
// `name` is the publisher name Google News gives in <source>; only items with that name are kept,
// so sister editions on the same domain (e.g. "marca usa", in English) stay out.
// Each one costs a subrequest when its language is refreshed (Workers allow 50 per run), but no extra
// KV writes: everything is merged into the same news:<lang> key.
export const OUTLETS = {
  en: [
    { name: 'The Guardian', site: 'theguardian.com' },
    { name: 'BBC', site: 'bbc.co.uk' },
  ],
  es: [
    { name: 'MARCA', site: 'marca.com' },
    { name: 'Diario AS', site: 'as.com' },
    { name: 'Mundo Deportivo', site: 'mundodeportivo.com' },
    { name: 'SPORT', site: 'sport.es' },
    { name: 'EL PAÍS', site: 'elpais.com' },
  ],
  pt: [
    { name: 'Record', site: 'record.pt' },
    { name: 'A Bola', site: 'abola.pt' },
    { name: 'O Jogo', site: 'ojogo.pt' },
  ],
};

export const NEWS_DAYS = 7;
export const NEWS_QUERY = `"Mourinho" when:${NEWS_DAYS}d`;
export const NEWS_LIMIT = 15;
// Most items any one publisher may take, so a prolific outlet cannot fill the list.
export const NEWS_PER_SOURCE = 3;

export const outletQuery = (site) => `"Mourinho" site:${site} when:${NEWS_DAYS}d`;

// The club Mourinho currently manages. When he moves, change both constants and the club name in
// `highlightsSub` (all three languages) in src/content/ui.json.
// TEAM_ID is ESPN's team id (86 = Real Madrid); HIGHLIGHTS_URL is the club's YouTube videos page.
export const TEAM_ID = 86;
export const HIGHLIGHTS_URL = 'https://www.youtube.com/@realmadrid/videos';

export const KV_KEYS = {
  news: (lang) => `news:${lang}`,
  matches: 'matches',
};

const UA = 'Mozilla/5.0 (compatible; InfinitoMourinhoBot/1.0)';

export function googleNewsUrl({ hl, gl, ceid }, query = NEWS_QUERY) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .trim();
}

// Built once per tag name: a cron run parses thousands of items within the free plan's CPU budget.
const TAG_RE = {};

function tag(block, name) {
  TAG_RE[name] ??= new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(TAG_RE[name]);
  return m ? decodeEntities(m[1]) : '';
}

// Minimal RSS 2.0 parser: Workers have no DOMParser, and Google News RSS is simple and stable.
export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    let title = tag(block, 'title');
    const source = tag(block, 'source');
    // Google News appends " - Publisher" to every title.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag(block, 'link');
    const date = new Date(tag(block, 'pubDate'));
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({
      title,
      link,
      source,
      publishedAt: isNaN(date) ? null : date.toISOString(),
    });
  }
  return items;
}

const byNewest = (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '');

// Newest first, deduped by link and title, at most `perSource` per publisher.
// Each `featured` list (one per outlet) gets its newest item in first, so every outlet we ask for
// shows up even when the general feeds are fresher.
export function mergeNews(lists, { limit = NEWS_LIMIT, perSource = NEWS_PER_SOURCE, featured = [] } = {}) {
  const seen = new Set();
  const perCount = new Map();
  const out = [];
  const take = (item) => {
    const key = item.title.toLowerCase();
    const n = perCount.get(item.source) || 0;
    if (seen.has(item.link) || seen.has(key) || n >= perSource) return false;
    seen.add(item.link);
    seen.add(key);
    perCount.set(item.source, n + 1);
    out.push(item);
    return true;
  };
  for (const list of featured) {
    for (const item of [...list].sort(byNewest)) if (out.length < limit && take(item)) break;
  }
  for (const item of [...lists, ...featured].flat().sort(byNewest)) {
    if (out.length >= limit) break;
    take(item);
  }
  return out.sort(byNewest);
}

// `site:` searches also match pages that only mention him in passing, and Google sometimes ignores
// `when:` there, so outlet items must come from the outlet itself, name him in the title and be recent.
export function outletItems(items, outlet, now = new Date()) {
  const since = new Date(now.getTime() - NEWS_DAYS * 24 * 3600 * 1000).toISOString();
  const name = outlet.name.toLowerCase();
  return items.filter(
    (i) => i.source.toLowerCase() === name && /mourinho/i.test(i.title) && i.publishedAt && i.publishedAt >= since,
  );
}

// ESPN answers 403 to our bot User-Agent, so it is only sent where it is accepted (Google News).
async function fetchText(url, { ua = true } = {}) {
  const res = await fetch(url, { headers: ua ? { 'User-Agent': UA } : {}, cf: { cacheTtlByStatus: { '200-299': 300, '300-599': 0 } } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export const NEWS_RETRY_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google News answers 503 to most of a burst of parallel requests from Cloudflare, but serves them one
// at a time. So feeds are fetched sequentially, retrying once after a pause when rate-limited.
// Returns null when the feed could not be fetched.
async function fetchGoogleNews(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseRss(await fetchText(url));
    } catch (err) {
      if (attempt || !/^(429|503) /.test(err.message)) return null;
      await sleep(NEWS_RETRY_MS);
    }
  }
}

export async function fetchNews(lang, now = new Date()) {
  return (await fetchNewsWithReport(lang, now)).items;
}

// Also names the outlets that returned nothing usable (failed, renamed in Google News, or quiet) and
// counts the feeds that could not be fetched at all, so the cron log shows when Google refuses us.
export async function fetchNewsWithReport(lang, now = new Date()) {
  const sources = NEWS_SOURCES[lang];
  if (!sources) throw new Error(`unknown lang ${lang}`);
  let failedFeeds = 0;
  const general = [];
  for (const s of sources) {
    const items = await fetchGoogleNews(googleNewsUrl(s));
    if (items) general.push(items);
    else failedFeeds++;
  }
  const featured = [];
  for (const o of OUTLETS[lang]) {
    const items = await fetchGoogleNews(googleNewsUrl(sources[0], outletQuery(o.site)));
    if (!items) failedFeeds++;
    featured.push(items ? outletItems(items, o, now) : []);
  }
  return {
    items: mergeNews(general, { featured }),
    failedFeeds,
    emptyOutlets: OUTLETS[lang].filter((_, i) => !featured[i].length).map((o) => o.name),
  };
}

function team(c) {
  return {
    name: c.team?.shortDisplayName || c.team?.displayName || '?',
    fullName: c.team?.displayName || '',
    logo: c.team?.logos?.[0]?.href || c.team?.logo || '',
    score: c.score?.displayValue ?? (typeof c.score === 'string' ? c.score : null),
  };
}

export function normalizeEvent(e) {
  const comp = e.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;
  return {
    id: e.id,
    date: e.date,
    completed: Boolean(comp.status?.type?.completed),
    competition: e.league?.name || e.season?.displayName || '',
    home: team(home),
    away: team(away),
  };
}

export function pickMatches(events, now = new Date()) {
  const byId = new Map();
  for (const e of events) {
    const n = normalizeEvent(e);
    if (n) byId.set(n.id, n);
  }
  const all = [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  const past = all.filter((m) => m.completed && new Date(m.date) < now);
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const upcoming = all.filter((m) => !m.completed && new Date(m.date) >= dayAgo);
  return { latest: past.at(-1) || null, next: upcoming[0] || null };
}

// ESPN's `season=Y` is the season that starts in year Y and lists completed matches only;
// upcoming fixtures come from `fixture=true`. Asking for this year's and last year's season
// always covers the current one, whichever half of it we are in.
export function scheduleUrls(now = new Date(), teamId = TEAM_ID) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/schedule`;
  const y = now.getUTCFullYear();
  return [`${base}?season=${y - 1}`, `${base}?season=${y}`, `${base}?fixture=true`];
}

export async function fetchMatches(now = new Date()) {
  const urls = scheduleUrls(now);
  const results = await Promise.allSettled(urls.map((u) => fetchText(u, { ua: false }).then(JSON.parse)));
  const events = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value.events || []);
  return pickMatches(events, now);
}

// The cron refreshes one language per run (en, es, pt in turn, so each hourly), which keeps a run's
// burst of Google News requests and its CPU time within what the free plan tolerates.
export function langForRun(now = new Date(), everyMinutes = 20) {
  return LANGS[Math.floor(now.getTime() / (everyMinutes * 60 * 1000)) % LANGS.length];
}

// Writes only when the new data is usable, so a failed upstream never wipes the last good copy.
export async function refreshAll(kv, now = new Date(), langs = LANGS) {
  const report = {};
  for (const lang of langs) {
    try {
      const { items, emptyOutlets, failedFeeds } = await fetchNewsWithReport(lang, now);
      if (emptyOutlets.length) report[`outlets:${lang}:empty`] = emptyOutlets;
      if (failedFeeds) report[`feeds:${lang}:failed`] = failedFeeds;
      if (items.length) {
        await kv.put(KV_KEYS.news(lang), JSON.stringify({ updatedAt: now.toISOString(), items }));
      }
      report[`news:${lang}`] = items.length;
    } catch (err) {
      report[`news:${lang}`] = `error: ${err.message}`;
    }
  }
  try {
    const m = await fetchMatches(now);
    if (m.latest || m.next) {
      await kv.put(KV_KEYS.matches, JSON.stringify({ updatedAt: now.toISOString(), ...m }));
    }
    report.matches = Boolean(m.latest || m.next);
  } catch (err) {
    report.matches = `error: ${err.message}`;
  }
  return report;
}
