import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRss, mergeNews, outletItems, fetchNewsWithReport, pickMatches, refreshAll, fetchMatches, scheduleUrls, KV_KEYS, OUTLETS,
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

test('mergeNews does not let a featured outlet exceed its cap or duplicate a general item', () => {
  const dup = news('AS', 5);
  const merged = mergeNews([[dup]], { limit: 10, perSource: 1, featured: [[dup, news('AS', 4)]] });
  assert.deepEqual(merged.map((i) => i.title), ['AS 5']);
});

test('outletItems keeps only recent items from the outlet that name Mourinho in the title', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const items = [
    news('Marca', 9, 'Mourinho rotates the squad'),
    news('Marca', 8, 'Ancelotti speaks'),
    { ...news('Marca', 7, 'MOURINHO in 2024'), publishedAt: '2024-06-01T00:00:00.000Z' },
    { ...news('Marca', 6, 'Mourinho undated'), publishedAt: null },
    news('marca usa', 5, 'Mourinho in English'),
  ];
  assert.deepEqual(outletItems(items, { name: 'MARCA' }, now).map((i) => i.title), ['Mourinho rotates the squad']);
});

test('fetchNews queries every outlet with site: and mixes its items in', async () => {
  const now = new Date('2026-10-28T00:00:00Z');
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(url);
    const site = new URL(url).searchParams.get('q').match(/site:(\S+)/)?.[1];
    const outlet = OUTLETS.es.find((o) => o.site === site);
    // The last outlet answers under a different publisher name, so it must be reported as empty.
    const name = !outlet ? 'Wire' : outlet === OUTLETS.es.at(-1) ? 'Someone Else' : outlet.name;
    const title = `Mourinho in ${site || 'general'} - ${name}`;
    return new Response(`<rss><item><title>${title}</title><link>https://news.google.com/${site || 'g'}</link>
<pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate><source url="https://x">${name}</source></item></rss>`);
  };
  let r;
  try {
    r = await fetchNewsWithReport('es', now);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(urls.length, 2 + OUTLETS.es.length);
  const expected = OUTLETS.es.slice(0, -1).map((o) => o.name);
  assert.deepEqual(r.items.map((i) => i.source).sort(), ['Wire', ...expected].sort());
  assert.deepEqual(r.emptyOutlets, [OUTLETS.es.at(-1).name]);
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
});

test('refreshAll keeps the last good copy when upstream fails', async () => {
  const store = new Map([[KV_KEYS.news('en'), 'old']]);
  const kv = { put: async (k, v) => store.set(k, v) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  try {
    await refreshAll(kv);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(store.get(KV_KEYS.news('en')), 'old');
  assert.equal(store.has(KV_KEYS.matches), false);
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
