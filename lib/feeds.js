// Shared feed logic for the cron Worker (workers/feeds) and the Pages Functions (functions/api).
// Everything here runs server-side on Cloudflare; the browser only ever reads our own /api/* JSON.

export const LANGS = ['en', 'es', 'pt', 'ja'];

// One news list for every language of the site, from the press that matters to him: Madrid (where he
// works), Barcelona (the rival), the national Spanish press, Portugal (where he is from) and England (the
// home of football). Headlines stay as printed; visitors translate the articles themselves if they wish.
// No US or Latin American editions; the English press comes from English outlets only (OUTLETS),
// since Google News's UK edition also carries US and other foreign sites. Each item keeps `press`
// ('es', 'pt' or 'en': which press it comes from, shown on the card) and, from an outlet, `lang`
// (the language it is written in, set on the headline).
export const NEWS_SOURCES = [
  { hl: 'es', gl: 'ES', ceid: 'ES:es', lang: 'es' },
  { hl: 'pt-PT', gl: 'PT', ceid: 'PT:pt-150', lang: 'pt' },
];

// Outlets we always want represented, read from their own RSS feeds: Google News refuses most requests
// from Cloudflare, but these publishers serve their feeds to our bot User-Agent. `name` matches the
// publisher name Google News uses, so the per-publisher cap also covers the general feeds above.
// Section feeds carry other news too, so only items naming Mourinho in the title or summary are kept;
// `all: true` marks a feed that is entirely about him. Sport (Barcelona) answers 406 to our bot and is
// not fetched under another name; it appears only when Google News carries it. O Jogo has no feed.
// The section front pages of AS and El País rarely carry him, so their Mourinho and Real Madrid tag
// feeds are read instead, still filtered by his name (the AS tag also carries match reports and other
// players' news). Each feed is one subrequest per cron run (two when it is retried), and no extra KV writes.
// `club: true` marks a feed of the current club's section or tag: on a move, swap each for the new club's (or a
// general football feed) — test/rules.test.mjs fails until their URLs name the new club.
export const OUTLETS = [
  // Madrid
  { name: 'MARCA', feed: 'https://e00-marca.uecdn.es/rss/futbol/real-madrid.xml', club: true, lang: 'es' },
  { name: 'Diario AS', feed: 'https://feeds.as.com/mrss-s/list/as/site/as.com/tag/jose_mourinho_a', lang: 'es' },
  // Barcelona
  { name: 'Mundo Deportivo', feed: 'https://www.mundodeportivo.com/feed/rss/futbol/real-madrid', club: true, lang: 'es' },
  // Spain, national
  { name: 'EL PAÍS', feed: 'https://feeds.elpais.com/mrss-s/list/ep/site/elpais.com/tag/real_madrid_a', club: true, lang: 'es' },
  { name: 'El Mundo', feed: 'https://e00-elmundo.uecdn.es/elmundodeporte/rss/futbol.xml', lang: 'es' },
  // Portugal
  { name: 'Record', feed: 'https://www.record.pt/rss', lang: 'pt' },
  { name: 'A Bola', feed: 'https://www.abola.pt/rss-articles.xml', lang: 'pt' },
  { name: 'Notícias ao Minuto', feed: 'https://www.noticiasaominuto.com/rss/desporto', lang: 'pt' },
  // England
  { name: 'The Guardian', feed: 'https://www.theguardian.com/football/jose-mourinho/rss', all: true, lang: 'en' },
  { name: 'BBC', feed: 'https://feeds.bbci.co.uk/sport/football/teams/real-madrid/rss.xml', club: true, lang: 'en' },
  { name: 'The Telegraph', feed: 'https://www.telegraph.co.uk/football/rss.xml', lang: 'en' },
  { name: 'Sky Sports', feed: 'https://www.skysports.com/rss/12040', lang: 'en' },
];

export const NEWS_DAYS = 7;
export const NEWS_QUERY = `"Mourinho" when:${NEWS_DAYS}d`;
export const NEWS_LIMIT = 15;
// Most items any one publisher may take, so a prolific outlet cannot fill the list. The looser cap
// applies only when the list would otherwise stay short.
export const NEWS_PER_SOURCE = 2;
export const NEWS_PER_SOURCE_FILL = 6;
// How many of the NEWS_LIMIT items each country's press may take: Spain leads, with Portugal and England
// beside it, and no one busy outlet can tip the balance (A Bola once took a third of the list). Slots a
// press leaves empty go to the others, Spanish first (NEWS_FILL_ORDER).
export const NEWS_PRESS_SLOTS = { es: 7, pt: 4, en: 4 };
export const NEWS_FILL_ORDER = ['es', 'pt', 'en'];

// The club Mourinho currently manages. When he moves, change both constants and the club name in
// src/content/ui.json (every language): `home.description`, `home.matchesHeading`,
// `home.highlightsSub`, `matches.title` and `matches.description` (`grep -n "Real Madrid"` finds them).
// Also replace the `current` record in src/content/stats.json (its `era`, numbers and `asOf`), after adding the new
// club's era to src/content/history.json, and the `club: true` feeds in OUTLETS above.
// TEAM_ID is ESPN's team id (86 = Real Madrid); HIGHLIGHTS_URL is the club's YouTube videos page.
// Before deploying a new TEAM_ID, open its 3 scheduleUrls(): each must answer 200 with an `events` list, and
// together they must hold at least one match, or the matches stop updating (fetchMatches fails as a whole, or
// refreshAll has nothing to write) and the hourly health check emails. Deploy with `npm run release`, which
// deploys the Worker too: it bundles this file separately from Pages.
// Japanese strings write the club in katakana (ja: レアル・マドリード).
// test/rules.test.mjs checks this list against ui.json, using the club named in the brackets above.
// MATCH_TIME_ZONE and MATCH_CITY: kick-off times are shown in the club's local time (Europe/Madrid for Real Madrid),
// labelled with the city ("Madrid time"), on the home match cards and /matches/; change them with the club too.
export const TEAM_ID = 86;
export const HIGHLIGHTS_URL = 'https://www.youtube.com/@realmadrid/videos';
export const MATCH_TIME_ZONE = 'Europe/Madrid';
// The city as each language writes it; English is the time zone's own name.
export const MATCH_CITY = { en: 'Madrid', es: 'Madrid', pt: 'Madrid', ja: 'マドリード' };

// One list for every language (see NEWS_SOURCES); the old news:en / news:es / news:pt keys are no longer read.
export const KV_KEYS = {
  news: 'news:local',
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

// Third-party text is cut to these lengths before it reaches KV and the pages, so a broken or hostile feed
// cannot bloat the stored list or the cards. Links must be https: the site is https-only.
export const MAX_TITLE = 300;
export const MAX_SOURCE = 100;
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Minimal RSS 2.0 parser: Workers have no DOMParser, and Google News and the outlets' RSS are simple.
// `summary` is only used to filter outlet items; mergeNews leaves it out of what is stored.
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
    if (!title || !/^https:\/\/[^\s"'<>]+$/.test(link)) continue;
    items.push({
      title: cut(title, MAX_TITLE),
      link,
      source: cut(source, MAX_SOURCE),
      publishedAt: isNaN(date) ? null : date.toISOString(),
      summary: tag(block, 'description'),
    });
  }
  return items;
}

const byNewest = (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '');

// Newest first, deduped by link and title, at most `perSource` per publisher and `slots[press]` per
// country's press while others have news. Each `featured` list (one per outlet) gets its newest item in
// first, so every outlet we ask for shows up even when the general feeds are fresher. If the caps leave
// the list short (e.g. Google News refused us and only a few outlets remain), the rest is filled
// without the press slots, Spanish press first (`fillOrder`), and then up to `fillPerSource` each.
export function mergeNews(
  lists,
  {
    limit = NEWS_LIMIT, perSource = NEWS_PER_SOURCE, fillPerSource = NEWS_PER_SOURCE_FILL, featured = [],
    slots = NEWS_PRESS_SLOTS, fillOrder = NEWS_FILL_ORDER,
  } = {},
) {
  const seen = new Set();
  const perCount = new Map();
  const perPress = new Map();
  const out = [];
  const take = (item, cap = perSource, bySlots = true) => {
    const key = item.title.toLowerCase();
    const n = perCount.get(item.source) || 0;
    const p = perPress.get(item.press) || 0;
    if (seen.has(item.link) || seen.has(key) || n >= cap) return false;
    if (bySlots && item.press && slots[item.press] != null && p >= slots[item.press]) return false;
    seen.add(item.link);
    seen.add(key);
    perCount.set(item.source, n + 1);
    perPress.set(item.press, p + 1);
    out.push({
      title: item.title, link: item.link, source: item.source, publishedAt: item.publishedAt,
      ...(item.press && { press: item.press }), ...(item.lang && { lang: item.lang }),
    });
    return true;
  };
  for (const list of featured) {
    for (const item of [...list].sort(byNewest)) if (out.length < limit && take(item)) break;
  }
  const rest = [...lists, ...featured].flat().sort(byNewest);
  for (const item of rest) if (out.length < limit) take(item);
  const rank = (item) => (fillOrder.includes(item.press) ? fillOrder.indexOf(item.press) : fillOrder.length);
  const fill = [...rest].sort((a, b) => rank(a) - rank(b) || byNewest(a, b));
  for (const cap of [perSource, fillPerSource]) {
    for (const item of fill) {
      if (out.length >= limit) break;
      take(item, cap, false);
    }
  }
  return out.sort(byNewest);
}

// His name, or "Mou" as the Spanish press calls him in headlines (capitalised, so "MoU" or Catalan
// "mou", "moves", do not count).
const isNamed = (text) => /mourinho/i.test(text) || /(?<![\p{L}])Mou(?![\p{L}])/u.test(text);

// Keeps an outlet feed's recent items about Mourinho, labelled with the outlet's name.
export function outletItems(items, outlet, now = new Date()) {
  const since = new Date(now.getTime() - NEWS_DAYS * 24 * 3600 * 1000).toISOString();
  return items
    .filter((i) => i.publishedAt && i.publishedAt >= since)
    .filter((i) => outlet.all || isNamed(i.title) || isNamed(i.summary || ''))
    .map((i) => ({ ...i, source: outlet.name, lang: outlet.lang, press: outlet.lang }));
}

// ESPN answers 403 to our bot User-Agent, so it is only sent where it is accepted (Google News, outlets).
// The Guardian answers 406 unless the request says it accepts XML.
async function fetchText(url, { ua = true } = {}) {
  const headers = ua ? { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' } : {};
  const res = await fetch(url, { headers, cf: { cacheTtlByStatus: { '200-299': 300, '300-599': 0 } } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  // A feed is a few hundred kilobytes at most; anything far larger is cut so parsing stays within the cron's
  // CPU budget (the parser's regular expressions run over the whole text).
  const text = await res.text();
  return text.length > MAX_FEED_CHARS ? text.slice(0, MAX_FEED_CHARS) : text;
}
export const MAX_FEED_CHARS = 3_000_000;

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

// An outlet feed that fails to arrive (a dropped connection, a 5xx or 429) is tried once more after a
// pause, so one bad moment does not drop that paper from the list until the next run 20 minutes later
// (AS, #67). Other 4xx (a moved or refused feed) will not mend on a retry, and a body that arrives but
// does not parse would come back the same from Cloudflare's cache, so neither is retried.
async function fetchOutlet(url) {
  return parseRss(await fetchTextRetry(url));
}

// The ESPN schedule is fetched with the same one retry.
async function fetchTextRetry(url, opts) {
  try {
    return await fetchText(url, opts);
  } catch (err) {
    if (/^4\d\d /.test(err.message) && !/^429 /.test(err.message)) throw err;
    await sleep(NEWS_RETRY_MS);
    return fetchText(url, opts);
  }
}

export async function fetchNews(now = new Date()) {
  return (await fetchNewsWithReport(now)).items;
}

// Also names the outlets that returned nothing usable (failed, moved their feed, or quiet), names those
// that could not be fetched at all even on the retry, and counts every feed that failed, so the cron log
// shows when a source refuses us.
export async function fetchNewsWithReport(now = new Date()) {
  let failedFeeds = 0;
  const general = [];
  for (const s of NEWS_SOURCES) {
    const items = await fetchGoogleNews(googleNewsUrl(s));
    // `press` is the edition's country press; the item's own language is not known (an edition carries
    // other languages too), so Google News items get no `lang`.
    if (items) general.push(items.map((i) => ({ ...i, press: s.lang })));
    else failedFeeds++;
  }
  // Different hosts, so the outlet feeds can be fetched in parallel.
  const outlets = await Promise.allSettled(OUTLETS.map((o) => fetchOutlet(o.feed)));
  const featured = outlets.map((r, i) => {
    if (r.status === 'fulfilled') return outletItems(r.value, OUTLETS[i], now);
    failedFeeds++;
    return [];
  });
  return {
    items: mergeNews(general, { featured }),
    failedFeeds,
    emptyOutlets: OUTLETS.filter((_, i) => !featured[i].length).map((o) => o.name),
    // Every failed outlet is also an empty one; `failedOutlets` tells the two kinds of empty apart.
    failedOutlets: OUTLETS.filter((_, i) => outlets[i].status === 'rejected').map((o) => o.name),
  };
}

// The logo URL is not shown to visitors (app.js uses our copies in src/public/logos/); `npm run images` uses it to
// know which teams have one. Only absolute https URLs are kept (anything else is dropped).
function httpsOnly(url) {
  return typeof url === 'string' && /^https:\/\//.test(url) ? url : '';
}

function team(c) {
  return {
    // ESPN's team id, so fan predictions can tell which side is the club (TEAM_ID) whatever the names say.
    id: c.team?.id != null ? String(c.team.id) : null,
    name: c.team?.shortDisplayName || c.team?.displayName || '?',
    fullName: c.team?.displayName || '',
    logo: httpsOnly(c.team?.logos?.[0]?.href || c.team?.logo),
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
    // ESPN puts a placeholder time on fixtures whose kick-off is not set yet ("11/29 - TBD").
    timeTbd: (comp.timeValid ?? e.timeValid) === false,
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
  // The /matches/ page lists this season only (newest result first), though the schedule URLs also
  // return last season's results. Still one KV write per run: the lists ride in the same JSON.
  const start = seasonStart(now);
  return {
    latest: past.at(-1) || null,
    next: upcoming[0] || null,
    results: past.filter((m) => new Date(m.date) >= start).reverse(),
    fixtures: upcoming.slice(0, FIXTURES_LIMIT),
  };
}

export const FIXTURES_LIMIT = 20;

// European seasons start in July: from July 2026 the season is 2026-27, before it 2025-26.
export function seasonStart(now = new Date()) {
  const y = now.getUTCFullYear();
  return new Date(Date.UTC(now.getUTCMonth() >= 6 ? y : y - 1, 6, 1));
}

// ESPN's `season=Y` is the season that starts in year Y and lists completed matches only;
// upcoming fixtures come from `fixture=true`. Asking for this year's and last year's season
// always covers the current one, whichever half of it we are in.
export function scheduleUrls(now = new Date(), teamId = TEAM_ID) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/schedule`;
  const y = now.getUTCFullYear();
  return [`${base}?season=${y - 1}`, `${base}?season=${y}`, `${base}?fixture=true`];
}

// All three lists or nothing: if only the fixtures failed, the past matches alone would still pass the
// write check in refreshAll and overwrite the last good copy with no next match, no fixtures and no
// voting (maintenance review). So one URL that fails even on its retry, or answers without an `events`
// list (ESPN changed its shape), fails the whole fetch, and the cron keeps the previous copy; the
// health check (scripts/health.mjs) notices if that lasts. A season not started yet answers an empty list,
// which is fine.
export async function fetchMatches(now = new Date()) {
  const urls = scheduleUrls(now);
  const results = await Promise.allSettled(urls.map(async (u) => {
    const body = JSON.parse(await fetchTextRetry(u, { ua: false }));
    if (!Array.isArray(body?.events)) throw new Error(`no events list: ${u}`);
    return body.events;
  }));
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));
  if (failed.length) throw new Error(`ESPN: ${failed.join('; ')}`);
  return pickMatches(results.flatMap((r) => r.value), now);
}

// Writes only when the new data is usable, so a failed upstream never wipes the last good copy.
// One news list and the matches per cron run (every 20 minutes): 2 Google News requests (one at a time),
// 12 outlet feeds and the 3 ESPN schedule URLs (each retried once if it fails to arrive): at most 34
// subrequests, under the free plan's 50, and at most 2 KV writes.
export async function refreshAll(kv, now = new Date()) {
  const report = {};
  try {
    const { items, emptyOutlets, failedOutlets, failedFeeds } = await fetchNewsWithReport(now);
    if (emptyOutlets.length) report['outlets:empty'] = emptyOutlets;
    if (failedOutlets.length) report['outlets:failed'] = failedOutlets;
    if (failedFeeds) report['feeds:failed'] = failedFeeds;
    if (items.length) await kv.put(KV_KEYS.news, JSON.stringify({ updatedAt: now.toISOString(), items }));
    report.news = items.length;
  } catch (err) {
    report.news = `error: ${err.message}`;
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
