import { test } from 'node:test';
import assert from 'node:assert/strict';
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
