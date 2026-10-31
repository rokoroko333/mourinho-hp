import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRss, mergeNews, outletItems, fetchNewsWithReport, pickMatches, seasonStart, normalizeEvent, refreshAll, fetchMatches, scheduleUrls, KV_KEYS, OUTLETS,
} from '../lib/feeds.js';

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Mourinho &amp; Madrid win again - Marca</title><link>https://news.google.com/a</link>
<pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate><source url="https://marca.com">Marca</source></item>
<item><title><![CDATA[Mourinho: "Respect" - AS]]></title><link>https://news.google.com/b</link>
<pubDate>Tue, 27 Oct 2026 12:00:00 GMT</pubDate><source url="https://as.com">AS</source></item>
<item><title>No link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

test('parseRss decodes entities, strips publisher suffix and drops unsafe links', () => {
  const items = parseRss(rss);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Mourinho & Madrid win again');
  assert.equal(items[0].source, 'Marca');
  assert.equal(items[1].title, 'Mourinho: "Respect"');
  assert.equal(items[1].publishedAt, '2026-10-27T12:00:00.000Z');
});

test('mergeNews dedupes by link and title and sorts newest first', () => {
  const a = parseRss(rss);
  const merged = mergeNews([a, [{ ...a[0], link: 'https://other' }]]);
  assert.deepEqual(merged.map((i) => i.link), ['https://news.google.com/b', 'https://news.google.com/a']);
});

const news = (source, hour, title = `${source} ${hour}`) => ({
  title, link: `https://news.google.com/${source}-${hour}`, source,
  publishedAt: new Date(Date.UTC(2026, 9, 27, hour)).toISOString(),
});

test('mergeNews caps each publisher and always includes the newest item of each featured outlet', () => {
  const general = [1, 2, 3, 4, 5, 6].map((h) => news('Big', 10 + h));
  const merged = mergeNews([general], { limit: 4, perSource: 2, featured: [[news('Marca', 1), news('Marca', 2)]] });
  assert.deepEqual(merged.map((i) => i.title), ['Big 16', 'Big 15', 'Marca 2', 'Marca 1']);
});

test('mergeNews never repeats an item, and loosens the cap only to fill a short list', () => {
  const dup = news('AS', 5);
  const featured = [[dup, news('AS', 4), news('AS', 3)]];
  const opts = { perSource: 1, fillPerSource: 2, featured };
  assert.deepEqual(mergeNews([[dup], [news('BBC', 1)]], { ...opts, limit: 2 }).map((i) => i.title), ['AS 5', 'BBC 1']);
  assert.deepEqual(mergeNews([[dup]], { ...opts, limit: 10 }).map((i) => i.title), ['AS 5', 'AS 4']);
});

test('mergeNews leans on the Spanish press: each press has its slots, and empty slots go to Spain first', () => {
  const item = (source, press, hour) => ({ ...news(source, hour), press });
  // A busy Portuguese outlet and fresher English news cannot crowd out the Spanish papers.
  const general = [
    ...[1, 2, 3, 4, 5].map((h) => item('A Bola', 'pt', 20 + h)),
    ...[1, 2, 3, 4, 5].map((h) => item('Record', 'pt', 20 + h)),
    ...[1, 2, 3].map((h) => item('BBC', 'en', 18 + h)),
    ...[1, 2, 3].map((h) => item('MARCA', 'es', h)),
    ...[1, 2, 3].map((h) => item('Diario AS', 'es', h)),
  ];
  const opts = { limit: 10, perSource: 3, slots: { es: 6, pt: 2, en: 2 } };
  const merged = mergeNews([general], opts);
  const by = (press) => merged.filter((i) => i.press === press).length;
  assert.deepEqual([by('es'), by('pt'), by('en')], [6, 2, 2]);
  // With little Spanish news, the free slots are filled from the Spanish press first, then the rest.
  const few = mergeNews([general.filter((i) => i.source !== 'Diario AS')], opts);
  assert.equal(few.length, 10);
  assert.equal(few.filter((i) => i.press === 'es').length, 3);
  assert.ok(few.filter((i) => i.source === 'A Bola').length <= 3, 'still at most perSource per outlet');
});

test('outletItems keeps recent items about Mourinho and labels them with the outlet', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const items = [
    news('', 9, 'Mourinho rotates the squad'),
    { ...news('', 8, 'Real Madrid win at home'), summary: 'José Mourinho praised the youngsters.' },
    news('', 7, 'Ancelotti speaks'),
    { ...news('', 6, 'MOURINHO in 2024'), publishedAt: '2024-06-01T00:00:00.000Z' },
    { ...news('', 5, 'Mourinho undated'), publishedAt: null },
  ];
  const kept = outletItems(items, { name: 'MARCA' }, now);
  assert.deepEqual(kept.map((i) => i.title), ['Mourinho rotates the squad', 'Real Madrid win at home']);
  assert.deepEqual([...new Set(kept.map((i) => i.source))], ['MARCA']);
  // A feed that is entirely about him keeps every recent item.
  assert.equal(outletItems(items, { name: 'The Guardian', all: true }, now).length, 3);
});

// Answers Google News with one general item, and each outlet feed with one item naming Mourinho,
// except the outlets in `quiet`, whose only item is about something else.
const fakeFeeds = ({ quiet = [], onFetch = () => {} } = {}) => async (url) => {
  await onFetch(url);
  const hl = new URL(url).searchParams.get('hl') || '';
  const outlet = OUTLETS.find((o) => o.feed === url);
  const title = !outlet ? `Mourinho general ${hl} - Wire` : quiet.includes(outlet) ? 'Other news' : `Mourinho in ${outlet.name}`;
  return new Response(`<rss><item><title>${title}</title><link>${outlet ? outlet.feed : 'https://news.google.com/'}/${hl}</link>
<pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate>${outlet ? '' : '<source url="https://x">Wire</source>'}
<description>&lt;p&gt;Summary&lt;/p&gt;</description></item></rss>`);
};

test('fetchNews reads the Spanish, Portuguese and English feeds and labels every item with its press language', async () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const urls = [];
  const realFetch = globalThis.fetch;
  const quiet = [OUTLETS.at(-1)];
  globalThis.fetch = fakeFeeds({ quiet, onFetch: (u) => urls.push(u) });
  let r;
  try {
    r = await fetchNewsWithReport(now);
  } finally {
    globalThis.fetch = realFetch;
  }
  // Google News for Spain and Portugal only (no US, Latin American or UK edition); England comes from its outlets.
  const google = urls.filter((u) => u.startsWith('https://news.google.com/')).map((u) => new URL(u).searchParams.get('gl'));
  assert.deepEqual(google, ['ES', 'PT']);
  assert.ok(OUTLETS.some((o) => o.lang === 'en'));
  assert.deepEqual(urls.filter((u) => !u.startsWith('https://news.google.com/')).sort(), OUTLETS.map((o) => o.feed).sort());
  assert.ok(OUTLETS.every((o) => ['es', 'pt', 'en'].includes(o.lang)));
  const expected = OUTLETS.slice(0, -1).map((o) => o.name);
  assert.deepEqual([...new Set(r.items.map((i) => i.source))].sort(), ['Wire', ...expected].sort());
  assert.deepEqual(r.emptyOutlets, [OUTLETS.at(-1).name]);
  assert.ok(r.items.every((i) => !('summary' in i) && ['es', 'pt', 'en'].includes(i.press)));
  // Google News items carry their edition's press but no language: an edition mixes languages.
  assert.ok(r.items.filter((i) => i.source === 'Wire').every((i) => !i.lang));
  for (const o of expected) assert.equal(r.items.find((i) => i.source === o).lang, OUTLETS.find((x) => x.name === o).lang);
});

test('fetchNewsWithReport fetches Google News one feed at a time and retries once on 503', async () => {
  const seen = new Map();
  let open = 0;
  let maxOpen = 0;
  const google = fakeFeeds();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!url.startsWith('https://news.google.com/')) return google(url);
    open++;
    maxOpen = Math.max(maxOpen, open);
    await new Promise((r) => setTimeout(r, 5));
    open--;
    const n = (seen.get(url) || 0) + 1;
    seen.set(url, n);
    // Only the Portuguese feed is rate-limited, and only on the first attempt.
    if (n === 1 && url.includes('gl=PT')) return new Response('busy', { status: 503 });
    return google(url);
  };
  let r;
  try {
    r = await fetchNewsWithReport(new Date('2026-10-28T00:00:00Z'));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(maxOpen, 1);
  assert.deepEqual([...seen.values()].sort(), [1, 2]);
  // Every general feed made it in, including the one that needed the retry, plus every outlet.
  assert.equal(r.items.length, 2 + OUTLETS.length);
  assert.equal(r.failedFeeds, 0);
});

const ev = (id, date, completed, hs = '1', as = '0') => ({
  id, date, league: { name: 'LaLiga' },
  competitions: [{ status: { type: { completed } }, competitors: [
    { homeAway: 'home', score: { displayValue: hs }, team: { shortDisplayName: 'Real Madrid', logo: 'x' } },
    { homeAway: 'away', score: { displayValue: as }, team: { shortDisplayName: 'Barcelona' } },
  ] }],
});

test('pickMatches returns latest completed and next upcoming', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const r = pickMatches([
    ev('1', '2026-10-20T19:00Z', true),
    ev('2', '2026-10-26T19:00Z', true, '2', '2'),
    ev('3', '2026-11-01T19:00Z', false),
    ev('4', '2026-11-08T19:00Z', false),
    ev('2', '2026-10-26T19:00Z', true, '2', '2'),
  ], now);
  assert.equal(r.latest.id, '2');
  assert.equal(r.latest.home.score, '2');
  assert.equal(r.next.id, '3');
  assert.deepEqual(r.results.map((m) => m.id), ['2', '1']);
  assert.deepEqual(r.fixtures.map((m) => m.id), ['3', '4']);
  assert.equal(r.next.timeTbd, false);
});

test('normalizeEvent flags fixtures whose kick-off time is not set', () => {
  const e = ev('5', '2026-11-29T20:00Z', false);
  e.competitions[0].timeValid = false;
  assert.equal(normalizeEvent(e).timeTbd, true);
});

test('pickMatches lists results from this season only, newest first', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const r = pickMatches([
    ev('a', '2026-05-20T19:00Z', true),
    ev('b', '2026-08-20T19:00Z', true),
    ev('c', '2026-09-20T19:00Z', true),
  ], now);
  assert.deepEqual(r.results.map((m) => m.id), ['c', 'b']);
  assert.equal(r.latest.id, 'c');
});

test('seasonStart switches on 1 July', () => {
  assert.equal(seasonStart(new Date('2026-06-30T23:00:00Z')).toISOString(), '2025-07-01T00:00:00.000Z');
  assert.equal(seasonStart(new Date('2026-07-01T00:00:00Z')).toISOString(), '2026-07-01T00:00:00.000Z');
});

test('refreshAll keeps the last good copy when upstream fails', async () => {
  const store = new Map([[KV_KEYS.news, 'old']]);
  const kv = { put: async (k, v) => store.set(k, v) };
  let report;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  try {
    report = await refreshAll(kv, new Date());
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(store.get(KV_KEYS.news), 'old');
  assert.equal(store.has(KV_KEYS.matches), false);
  assert.equal(report['feeds:failed'], 2 + OUTLETS.length);
});

test('scheduleUrls covers the current season in both halves of the year, plus upcoming fixtures', () => {
  const qs = (d) => scheduleUrls(new Date(d), 86).map((u) => new URL(u).search);
  // October 2026 is in the 2026-27 season; March 2027 is still in it.
  assert.deepEqual(qs('2026-10-28T00:00:00Z'), ['?season=2025', '?season=2026', '?fixture=true']);
  assert.deepEqual(qs('2027-03-15T00:00:00Z'), ['?season=2026', '?season=2027', '?fixture=true']);
});

test('fetchMatches merges completed and fixture lists without the bot User-Agent', async () => {
  // Mirrors ESPN: season lists hold completed matches only, fixture=true holds upcoming ones.
  const bodies = {
    '?season=2025': [ev('1', '2026-05-23T19:00Z', true)],
    '?season=2026': [ev('2', '2026-10-25T20:00Z', true, '3', '1')],
    '?fixture=true': [ev('3', '2026-11-01T15:15Z', false)],
  };
  const realFetch = globalThis.fetch;
  const userAgents = [];
  globalThis.fetch = async (url, init) => {
    userAgents.push(init?.headers?.['User-Agent']);
    return new Response(JSON.stringify({ events: bodies[new URL(url).search] }));
  };
  let r;
  try {
    r = await fetchMatches(new Date('2026-10-28T00:00:00Z'));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(userAgents, [undefined, undefined, undefined]);
  assert.equal(r.latest.id, '2');
  assert.equal(r.next.id, '3');
});

test('normalizeEvent keeps only https logo URLs', () => {
  const e = ev('9', '2026-11-01T19:00Z', false);
  e.competitions[0].competitors[0].team.logo = 'https://a.espncdn.com/i/teamlogos/soccer/500/86.png';
  e.competitions[0].competitors[1].team.logo = 'javascript:alert(1)';
  const m = normalizeEvent(e);
  assert.equal(m.home.logo, 'https://a.espncdn.com/i/teamlogos/soccer/500/86.png');
  assert.equal(m.away.logo, '');
});

// The Spanish press the owner asked for (#63): the Madrid sports papers, the Barcelona ones and the two
// national dailies. Sport refuses our bot, so it only comes through Google News and has no outlet feed.
test('the outlets cover MARCA, AS, Mundo Deportivo, El País and El Mundo, and do not fetch Sport', () => {
  const spanish = OUTLETS.filter((o) => o.lang === 'es').map((o) => o.name);
  for (const name of ['MARCA', 'Diario AS', 'Mundo Deportivo', 'EL PAÍS', 'El Mundo']) assert.ok(spanish.includes(name), `${name} is an outlet`);
  assert.ok(!OUTLETS.some((o) => /sport\.es/.test(o.feed)), 'Sport answers 406 to our bot; do not fetch it under another name');
  // Their section fronts rarely carry him: AS is read from its Mourinho tag (all about him), El País from
  // its Real Madrid tag, filtered by his name.
  const by = (name) => OUTLETS.find((o) => o.name === name);
  assert.match(by('Diario AS').feed, /\/tag\/jose_mourinho_a$/);
  assert.equal(by('Diario AS').all, true);
  assert.match(by('EL PAÍS').feed, /\/tag\/real_madrid_a$/);
  assert.ok(!by('EL PAÍS').all && !by('El Mundo').all, 'El País and El Mundo feeds carry other news; keep the name filter');
});
