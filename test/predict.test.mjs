import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { BURST_LIMIT, NETWORK_LIMIT, networkOf, connectionOf, keyedHash, openMatch, outcomeOf, parseScore, purge, recordVote, summary } from '../lib/predict.js';
import { onRequestGet, onRequestPost } from '../functions/api/predict.js';
import { onRequestGet as homeGet } from '../functions/api/home.js';
import { KV_KEYS } from '../lib/feeds.js';

// A stand-in for D1 on Node's own SQLite, with the real schema: prepare(sql).bind(...).first() / run() / all().
async function fakeD1() {
  const db = new DatabaseSync(':memory:');
  // Every migration, in order, as D1 applies them.
  for (const f of (await readdir(new URL('../migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(await readFile(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  }
  const prepare = (sql) => ({
    sql,
    bind: (...args) => ({
      sql,
      args,
      first: async () => db.prepare(sql).get(...args) ?? null,
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
      // D1 returns plain objects; node:sqlite returns null-prototype ones.
      all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
    }),
  });
  return {
    db,
    // Like D1: the statements run in one transaction, all or nothing. `fail` makes the nth statement throw.
    fail: null,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((st, i) => {
          if (this.fail === i) throw new Error('D1 error');
          return { meta: { changes: Number(db.prepare(st.sql).run(...st.args).changes) } };
        });
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    prepare,
  };
}

const now = Date.parse('2026-10-31T12:00:00Z');
const madridAway = { id: '401', date: '2026-11-01T15:15Z', timeTbd: false, home: { id: '93', name: 'Racing' }, away: { id: '86', name: 'Real Madrid' } };
const matches = { next: madridAway, results: [], fixtures: [] };
const vote = (db, address, home, away, at = now) => recordVote(db, { secret: 's3cret', address, match: madridAway, home, away, now: at });

test('a vote is for the next match only, with a set kick-off still ahead', () => {
  assert.ok(openMatch(matches, '401', now).match);
  assert.equal(openMatch(matches, '999', now).status, 404);
  assert.equal(openMatch(matches, '401', Date.parse('2026-11-01T15:15Z')).error, 'closed at kick-off');
  assert.equal(openMatch({ next: { ...madridAway, timeTbd: true } }, '401', now).error, 'kick-off time not set');
  assert.equal(openMatch({ next: { ...madridAway, away: { id: '1' } } }, '401', now).status, 409);
  // A kick-off that does not parse never closes, so it is refused like an unset time.
  assert.equal(openMatch({ next: { ...madridAway, date: 'soon' } }, '401', now).error, 'kick-off time not set');
});

test('scores are whole numbers from 0 to 15', () => {
  assert.deepEqual(parseScore({ home: 1, away: 2 }), { home: 1, away: 2 });
  // Numbers only: strings, null, '' and booleans are refused rather than read as 0 or 1.
  for (const bad of [{ home: -1, away: 0 }, { home: 1.5, away: 0 }, { home: 16, away: 0 }, { home: 'x', away: 0 }, { home: '1', away: 2 }, { home: null, away: '' }, { home: true, away: 0 }, {}, null]) {
    assert.equal(parseScore(bad), null, JSON.stringify(bad));
  }
});

test('outcomes read from the club side, home or away', () => {
  assert.equal(outcomeOf(madridAway, 1, 2), 'win');
  assert.equal(outcomeOf(madridAway, 2, 1), 'loss');
  assert.equal(outcomeOf(madridAway, 1, 1), 'draw');
  const home = { ...madridAway, home: { id: '86' }, away: { id: '93' } };
  assert.equal(outcomeOf(home, 2, 1), 'win');
});

test('one vote per connection per match, a burst limit, and a summary from the tallies', async () => {
  const db = await fakeD1();
  assert.deepEqual(await vote(db, '1.1.1.1', 1, 2), { recorded: true });
  assert.deepEqual(await vote(db, '1.1.1.1', 0, 3), { recorded: false, reason: 'duplicate' });
  await vote(db, '2.2.2.2', 1, 2);
  await vote(db, '3.3.3.3', 1, 1);
  await vote(db, '4.4.4.4', 2, 0);
  const s = await summary(db, matches, '401');
  assert.equal(s.total, 4);
  assert.deepEqual(s.outcomes, { win: 2, draw: 1, loss: 1 });
  assert.deepEqual(s.top[0], { home: 1, away: 2, votes: 2 });
  assert.equal(s.clubIsHome, false);
  // The same connection voting on match after match is cut off within the window.
  const flood = await fakeD1();
  const results = [];
  for (let i = 0; i < BURST_LIMIT + 2; i++) results.push((await recordVote(flood, { secret: 's3cret', address: '9.9.9.9', match: { ...madridAway, id: String(500 + i) }, home: 1, away: 0, now })).reason);
  assert.equal(results.filter((r) => r === 'burst').length, 2);
  // No address is stored: only keyed hashes.
  const stored = JSON.stringify(db.db.prepare('SELECT * FROM votes').all()) + JSON.stringify(db.db.prepare('SELECT * FROM bursts').all());
  assert.doesNotMatch(stored, /1\.1\.1\.1|2\.2\.2\.2/);
  assert.match(await keyedHash('s3cret', 'vote', '401', '1.1.1.1'), /^[0-9a-f]{64}$/);
});

test('the summary adds the result and the exact hits once the match is played', async () => {
  const db = await fakeD1();
  await vote(db, '1.1.1.1', 1, 2);
  await vote(db, '2.2.2.2', 1, 2);
  await vote(db, '3.3.3.3', 0, 0);
  const played = { ...madridAway, completed: true, home: { ...madridAway.home, score: '1' }, away: { ...madridAway.away, score: '2' } };
  const s = await summary(db, { next: null, results: [played] }, '401');
  assert.deepEqual(s.result, { home: 1, away: 2, outcome: 'win', hits: 2 });
  assert.equal(await summary(db, { next: null, results: [] }, '401'), null);
});

test('purge drops votes 30 days after kick-off and keeps the tallies', async () => {
  const db = await fakeD1();
  await vote(db, '1.1.1.1', 1, 2);
  const later = Date.parse('2026-12-02T00:00:00Z');
  const r = await purge(db, later);
  assert.equal(r.votesDeleted, 1);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM votes').get().n, 0);
  assert.equal(db.db.prepare('SELECT SUM(votes) AS n FROM tallies').get().n, 1);
  assert.equal(r.burstsDeleted, 1);
  // Not yet 30 days: kept.
  const fresh = await fakeD1();
  await vote(fresh, '1.1.1.1', 1, 2);
  assert.equal((await purge(fresh, Date.parse('2026-11-20T00:00:00Z'))).votesDeleted, 0);
});

test('an IPv6 connection is its /64, so changing the rest of the address does not give another vote', async () => {
  assert.equal(connectionOf('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(connectionOf('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64');
  assert.equal(connectionOf('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(connectionOf('203.0.113.7'), '203.0.113.7');
  // IPv4 written as IPv6 stays the IPv4 address, not one shared 0:0:0:0 network.
  assert.equal(connectionOf('::ffff:1.2.3.4'), '1.2.3.4');
  assert.notEqual(connectionOf('::ffff:1.2.3.4'), connectionOf('::ffff:5.6.7.8'));
  const db = await fakeD1();
  assert.equal((await vote(db, '2001:db8:1:2::10', 1, 2)).recorded, true);
  assert.equal((await vote(db, '2001:db8:1:2:ffff::99', 0, 0)).reason, 'duplicate');
});

test('a repeated vote is a duplicate and does not use up the burst limit', async () => {
  const db = await fakeD1();
  await vote(db, '5.5.5.5', 1, 2);
  for (let i = 0; i < BURST_LIMIT + 3; i++) assert.equal((await vote(db, '5.5.5.5', 1, 2)).reason, 'duplicate');
  assert.equal(db.db.prepare('SELECT SUM(n) AS n FROM bursts').get().n, 1);
});

test('the purge moves counts and deletes votes together, or not at all', async () => {
  const db = await fakeD1();
  await vote(db, '1.1.1.1', 1, 2);
  await vote(db, '2.2.2.2', 1, 2);
  db.fail = 1; // the DELETE fails after the INSERT
  await assert.rejects(purge(db, Date.parse('2026-12-02T00:00:00Z')));
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM votes').get().n, 2);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM tallies').get().n, 0);
  assert.equal((await summary(db, matches, '401')).total, 2, 'nothing counted twice or lost');
  db.fail = null;
  await purge(db, Date.parse('2026-12-02T00:00:00Z'));
  assert.equal((await summary(db, matches, '401')).total, 2, 'the same total from the tallies alone');
});

// The Pages Function itself: what it refuses, and that it records through lib/predict.js.
test('the predict endpoint refuses other sites, non-JSON, bad scores, closed matches, bursts and missing setup', async () => {
  const db = await fakeD1();
  const env = { VOTES: db, VOTE_SALT: 's3cret', FEEDS: { get: async () => JSON.stringify(matches) } };
  const post = (body, headers = {}, e = env, url = 'https://site.example/api/predict') =>
    onRequestPost({ request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '7.7.7.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env: e });
  const realNow = Date.now;
  Date.now = () => now;
  try {
    assert.equal((await post({ match: '401', home: 1, away: 2 }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('match=401', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await post({ match: '401', home: 99, away: 2 })).status, 400);
    assert.equal((await post({ match: '401', home: 1, away: 2 }, {}, { ...env, VOTE_SALT: undefined })).status, 503);
    assert.equal((await post({ match: '401', home: 1, away: 2 }, { 'CF-Connecting-IP': '' })).status, 503, 'no address in production');
    const ok = await post({ match: '401', home: 1, away: 2 });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).recorded, true);
    assert.equal((await (await post({ match: '401', home: 0, away: 0 })).json()).duplicate, true);
    const closed = { ...env, FEEDS: { get: async () => JSON.stringify({ next: { ...madridAway, date: '2026-10-31T11:00Z' } }) } };
    assert.equal((await post({ match: '401', home: 1, away: 2 }, { 'CF-Connecting-IP': '8.8.8.8' }, closed)).status, 409);
    // A connection that has already used its window on other matches is refused with 429.
    const flood = { ...env, VOTES: await fakeD1() };
    for (let i = 0; i < BURST_LIMIT; i++) await recordVote(flood.VOTES, { secret: 's3cret', address: '9.9.9.9', match: { ...madridAway, id: String(500 + i) }, home: 1, away: 0, now });
    assert.equal((await post({ match: '401', home: 1, away: 2 }, { 'CF-Connecting-IP': '9.9.9.9' }, flood)).status, 429);
    const local = await post({ match: '401', home: 2, away: 2 }, { 'CF-Connecting-IP': '' }, { ...env, VOTES: await fakeD1() }, 'http://localhost:8788/api/predict');
    assert.equal(local.status, 200, 'the local dev server stands in for the address');
    const get = await onRequestGet({ request: new Request('https://site.example/api/predict?match=401'), env });
    assert.equal((await get.json()).total, 1);
    assert.equal((await onRequestGet({ request: new Request('https://site.example/api/predict?match=x'), env })).status, 400);
  } finally {
    Date.now = realNow;
  }
});

test('one IPv6 /48 may cast at most NETWORK_LIMIT votes per match; IPv4 has no such limit', async () => {
  assert.equal(networkOf('2001:db8:1:2:aaaa::1'), '2001:db8:1::/48');
  assert.equal(networkOf('203.0.113.7'), null);
  const db = await fakeD1();
  const results = [];
  // Each /64 in the /48 is a new "connection", as a tunnel broker would hand out.
  for (let i = 0; i < NETWORK_LIMIT + 2; i++) results.push((await vote(db, `2001:db8:1:${(i + 1).toString(16)}::1`, 1, 0)).reason ?? 'ok');
  assert.equal(results.filter((r) => r === 'ok').length, NETWORK_LIMIT);
  assert.deepEqual(results.slice(-2), ['network', 'network']);
  assert.equal((await vote(db, '2001:db8:2:1::1', 1, 0)).recorded, true, 'another /48 still votes');
  assert.equal((await vote(db, '203.0.113.9', 1, 0)).recorded, true, 'IPv4 is not limited by network');
  assert.equal(db.db.prepare('SELECT COUNT(DISTINCT network) AS n FROM votes WHERE network IS NOT NULL').get().n, 2);
  assert.doesNotMatch(JSON.stringify(db.db.prepare('SELECT * FROM votes').all()), /2001:db8|203\.0/, 'only keyed hashes are stored');
  // The count is the votes themselves, so it goes with them at the purge.
  await purge(db, Date.parse('2026-12-02T00:00:00Z'));
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM votes').get().n, 0);
});

test('the endpoint answers 429 past the /48 limit, 503 when D1 fails, and caches the tally it reads', async () => {
  const realNow = Date.now;
  Date.now = () => now;
  const db = await fakeD1();
  const env = { VOTES: db, VOTE_SALT: 's3cret', FEEDS: { get: async () => JSON.stringify(matches) } };
  const post = (ip, e = env) => onRequestPost({ request: new Request('https://site.example/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ match: '401', home: 1, away: 0 }) }), env: e });
  const realCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => store.set(r.url, res) } };
  try {
    for (let i = 0; i < NETWORK_LIMIT; i++) assert.equal((await post(`2001:db8:5:${(i + 1).toString(16)}::1`)).status, 200);
    assert.equal((await post('2001:db8:5:ffff::1')).status, 429);
    // D1 throwing (down, or over its daily quota) is a 503, not an exception.
    const broken = { ...env, VOTES: { prepare: () => { throw new Error('D1_ERROR: quota'); } } };
    assert.equal((await post('7.7.7.7', broken)).status, 503);
    const get = (e) => onRequestGet({ request: new Request('https://site.example/api/predict?match=401'), env: e, waitUntil: () => {} });
    assert.equal((await get(broken)).status, 503);
    // The tally is read once and then served from the cache: a new vote does not show until the TTL.
    assert.equal((await (await get(env)).json()).total, NETWORK_LIMIT);
    await post('8.8.8.8');
    assert.equal((await (await get(env)).json()).total, NETWORK_LIMIT, 'cached');
  } finally {
    globalThis.caches = realCaches;
    Date.now = realNow;
  }
});

test('the kick-off is stored normalised, so the purge finds it whatever form the feed used', async () => {
  const db = await fakeD1();
  await recordVote(db, { secret: 's3cret', address: '1.1.1.1', match: { ...madridAway, date: '2026-11-01T15:15Z' }, home: 1, away: 2, now });
  assert.equal(db.db.prepare('SELECT kickoff FROM votes').get().kickoff, '2026-11-01T15:15:00.000Z');
});

test('/api/home answers the news, the matches and the tallies in one response, with the API headers', async () => {
  const db = await fakeD1();
  await vote(db, '1.1.1.1', 1, 2);
  const kv = { [KV_KEYS.news]: JSON.stringify({ items: [{ title: 'Mourinho', link: 'https://x' }] }), [KV_KEYS.matches]: JSON.stringify(matches) };
  const env = { VOTES: db, FEEDS: { get: async (k) => kv[k] ?? null } };
  const realCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => store.set(r.url, res) } };
  const waits = [];
  const ctx = (url) => ({ request: new Request(url), env, waitUntil: (p) => waits.push(p) });
  try {
    const res = await homeGet(ctx('https://site.example/api/home?lang=ja'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(res.headers.get('Content-Security-Policy'), /default-src 'none'/);
    const body = await res.json();
    assert.equal(body.news.items[0].title, 'Mourinho');
    assert.equal(body.matches.next.id, '401');
    assert.equal(body.predict['401'].total, 1);
    assert.equal((await homeGet(ctx('https://site.example/api/home?lang=xx'))).status, 400);
    await Promise.all(waits);
    // Another language or a random query is the same cache entry; the D1 count does not run again.
    await vote(db, '2.2.2.2', 0, 0);
    assert.equal((await (await homeGet(ctx('https://site.example/api/home?lang=es&x=1'))).json()).predict['401'].total, 1);
    // With D1 failing, the news and the matches still go out, without tallies.
    store.clear();
    const broken = { ...env, VOTES: { prepare: () => { throw new Error('D1_ERROR'); } } };
    const res2 = await homeGet({ request: new Request('https://site.example/api/home?lang=en'), env: broken, waitUntil: () => {} });
    const body2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.ok(body2.news && body2.matches);
    assert.deepEqual(body2.predict, {});
  } finally {
    globalThis.caches = realCaches;
  }
});
