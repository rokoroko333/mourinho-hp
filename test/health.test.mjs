import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkHome, MAX_AGE_MS } from '../scripts/health.mjs';

const now = new Date('2026-11-01T12:00:00Z');
const at = (ms) => new Date(now - ms).toISOString();
const home = (newsAge, matchesAge) => ({
  news: { updatedAt: at(newsAge), items: [{ title: 'x' }] },
  matches: { updatedAt: at(matchesAge), next: null, latest: null },
  predict: {},
});

test('checkHome: fresh news and matches are healthy', () => {
  assert.deepEqual(checkHome(home(20 * 60000, MAX_AGE_MS - 60000), now), []);
});

test('checkHome: names whichever part stopped being refreshed', () => {
  assert.deepEqual(checkHome(home(0, MAX_AGE_MS + 60000), now).map((p) => p.split(':')[0]), ['matches']);
  assert.deepEqual(checkHome(home(MAX_AGE_MS + 60000, 0), now).map((p) => p.split(':')[0]), ['news']);
  assert.match(checkHome(home(0, 3 * 3600 * 1000), now)[0], /180 minutes ago/);
});

test('checkHome: a missing part, a missing date or an empty news list is a problem', () => {
  assert.deepEqual(checkHome({ news: null, matches: null }, now), ['news: missing', 'matches: missing']);
  assert.deepEqual(checkHome(null, now), ['news: missing', 'matches: missing']);
  const b = home(0, 0);
  delete b.matches.updatedAt;
  b.news.items = [];
  assert.deepEqual(checkHome(b, now), ['matches: no updatedAt', 'news: no items']);
});

test('checkHome: a copy fetched on the spot (KV empty or down) is a problem even with a fresh date', () => {
  const b = home(0, 0);
  b.matches.live = true;
  assert.deepEqual(checkHome(b, now).map((p) => p.split(':')[0]), ['matches']);
});

test('readFeed marks a copy fetched on the spot as live, and returns the cron copy from KV as it is', async () => {
  const { readFeed } = await import('../lib/serve.js');
  const puts = [];
  const empty = { env: { FEEDS: { get: async () => null, put: async (k, v) => puts.push(v) } }, waitUntil: (p) => p };
  const live = JSON.parse(await readFeed(empty, { key: 'matches', live: async () => ({ next: { id: '1' } }) }));
  assert.equal(live.live, true);
  assert.equal(JSON.parse(puts[0]).live, true, 'the seeded KV copy stays marked until the cron replaces it');
  const cron = JSON.stringify({ updatedAt: now.toISOString(), next: { id: '1' } });
  const fromKv = await readFeed({ env: { FEEDS: { get: async () => cron } }, waitUntil: () => {} }, { key: 'matches', live: async () => ({}) });
  assert.equal(JSON.parse(fromKv).live, undefined);
});

test('readFeed does not seed KV after a failed read, so a live copy never replaces the cron copy', async () => {
  const { readFeed } = await import('../lib/serve.js');
  const puts = [];
  const down = { env: { FEEDS: { get: async () => { throw new Error('limit'); }, put: async (k, v) => puts.push(v) } }, waitUntil: (p) => p };
  const body = JSON.parse(await readFeed(down, { key: 'matches', live: async () => ({ next: { id: '1' } }) }));
  assert.equal(body.live, true);
  assert.equal(puts.length, 0);
});

// The workflow runs the file itself: its exit code must come through main() and the "run directly" check
// (no network needed: a missing --base value is refused before any request).
test('node scripts/health.mjs exits with its own code when run directly', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/health.mjs', import.meta.url)), '--base'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /usage: npm run health/);
});
