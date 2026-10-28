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

export const NEWS_QUERY = '"Mourinho" when:7d';
export const NEWS_LIMIT = 15;

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

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
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

export function mergeNews(lists, limit = NEWS_LIMIT) {
  const seen = new Set();
  const out = [];
  for (const item of lists.flat()) {
    const key = item.title.toLowerCase();
    if (seen.has(item.link) || seen.has(key)) continue;
    seen.add(item.link);
    seen.add(key);
    out.push(item);
  }
  out.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  return out.slice(0, limit);
}

// ESPN answers 403 to our bot User-Agent, so it is only sent where it is accepted (Google News).
async function fetchText(url, { ua = true } = {}) {
  const res = await fetch(url, { headers: ua ? { 'User-Agent': UA } : {}, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export async function fetchNews(lang) {
  const sources = NEWS_SOURCES[lang];
  if (!sources) throw new Error(`unknown lang ${lang}`);
  const results = await Promise.allSettled(sources.map((s) => fetchText(googleNewsUrl(s)).then(parseRss)));
  const lists = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  return mergeNews(lists);
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

// Writes only when the new data is usable, so a failed upstream never wipes the last good copy.
export async function refreshAll(kv, now = new Date()) {
  const report = {};
  await Promise.all(
    LANGS.map(async (lang) => {
      try {
        const items = await fetchNews(lang);
        if (items.length) {
          await kv.put(KV_KEYS.news(lang), JSON.stringify({ updatedAt: now.toISOString(), items }));
        }
        report[`news:${lang}`] = items.length;
      } catch (err) {
        report[`news:${lang}`] = `error: ${err.message}`;
      }
    }),
  );
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
