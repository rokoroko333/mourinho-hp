import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { BURST_LIMIT, keyedHash, openMatch, outcomeOf, parseScore, purge, recordVote, summary } from '../lib/predict.js';

// A stand-in for D1 on Node's own SQLite, with the real schema: prepare(sql).bind(...).first() / run() / all().
async function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(new URL('../migrations/0001_predictions.sql', import.meta.url), 'utf8'));
  return {
    db,
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => db.prepare(sql).get(...args) ?? null,
        run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
        // D1 returns plain objects; node:sqlite returns null-prototype ones.
        all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
      }),
    }),
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
});

test('scores are whole numbers from 0 to 15', () => {
  assert.deepEqual(parseScore({ home: '1', away: 2 }), { home: 1, away: 2 });
  for (const bad of [{ home: -1, away: 0 }, { home: 1.5, away: 0 }, { home: 16, away: 0 }, { home: 'x', away: 0 }, {}]) assert.equal(parseScore(bad), null);
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
  // The same connection voting again and again (different matches or retries) is cut off within the window.
  const flood = await fakeD1();
  const results = [];
  for (let i = 0; i < BURST_LIMIT + 2; i++) results.push((await vote(flood, '9.9.9.9', i, 0)).reason);
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
