import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serveMatchesPage } from '../lib/matches-page.js';

// A built /matches/ page in miniature: what fillMatchesPage looks for, and nothing else.
const PAGE = `<body data-lang="en"><ol class="match-rows" id="fixture-list"><li class="loading">Loading…</li></ol>
<ol class="match-rows" id="result-list"><li class="loading">Loading…</li></ol>
<script type="application/json" id="strings">{"tbd":"TBC","matchesEmpty":"No matches"}</script></body>`;
const RESULT = { date: '2026-10-25T20:00Z', completed: true, competition: 'LaLiga', home: { name: 'Barcelona', score: '1' }, away: { name: 'Real Madrid', score: '2' } };

// Runs the Function with stand-ins for the edge cache, the static assets and KV, and reports what it served
// and what it put in the cache.
async function serve({ kv, page = PAGE }) {
  const stored = [];
  globalThis.caches = { default: { match: async () => undefined, put: async (req, res) => stored.push(res) } };
  const pending = [];
  const res = await serveMatchesPage({
    request: new Request('https://example.com/matches/'),
    env: {
      ASSETS: { fetch: async () => new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
      FEEDS: { get: async () => (typeof kv === 'function' ? kv() : kv) },
    },
    waitUntil: (p) => pending.push(p),
  });
  await Promise.all(pending);
  return { html: await res.text(), cached: stored.length };
}

test('serveMatchesPage fills the lists from KV and caches that page', async () => {
  const { html, cached } = await serve({ kv: JSON.stringify({ results: [RESULT], fixtures: [] }) });
  assert.match(html, /Barcelona<\/span><strong class="row-score">1 - 2</);
  assert.ok(html.includes('>No matches<'), 'the empty list says so');
  assert.equal(cached, 1);
});

test('serveMatchesPage serves the static page uncached when it has nothing to fill it with', async () => {
  const cases = {
    'KV empty': null,
    'KV throws': () => { throw new Error('limit'); },
    'not JSON': '{',
    'no matches': JSON.stringify({ results: [], fixtures: [] }),
    'old shape': JSON.stringify({ latest: RESULT, next: null }),
  };
  for (const [name, kv] of Object.entries(cases)) {
    const { html, cached } = await serve({ kv });
    assert.equal(html, PAGE, `${name}: static page as built`);
    assert.equal(cached, 0, `${name}: not cached`);
  }
  const unknown = PAGE.replace('id="result-list"', 'id="results"');
  const { html, cached } = await serve({ kv: JSON.stringify({ results: [RESULT] }), page: unknown });
  assert.equal(html, unknown, 'unknown markup: static page as built');
  assert.equal(cached, 0, 'unknown markup: not cached');
});
