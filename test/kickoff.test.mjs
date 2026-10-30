import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// src/assets/kickoff.js is a plain browser script that sets globalThis.mourinhoKickoff; run it alone.
const sandbox = {};
runInNewContext(await readFile(new URL('../src/assets/kickoff.js', import.meta.url), 'utf8'), sandbox);
const { kickoffOf, countdownText: text, cardDate } = sandbox.mourinhoKickoff;
const now = Date.parse('2026-10-31T12:00:00Z');

test('the countdown runs only to a confirmed kick-off that is still ahead', () => {
  assert.equal(kickoffOf({ date: '2026-11-01T15:15Z' }, now)?.toISOString(), '2026-11-01T15:15:00.000Z');
  assert.equal(kickoffOf({ date: '2026-11-08T05:00Z', timeTbd: true }, now), null, 'time to be confirmed');
  assert.equal(kickoffOf({ date: '2026-10-31T11:00Z' }, now), null, 'already started');
  assert.equal(kickoffOf(null, now), null, 'no next match');
});

test('the countdown reads in days, hours, minutes and two-digit seconds', () => {
  const units = { d: 'd', h: 'h', m: 'min', s: 's' };
  assert.equal(text(2 * 86400 + 4 * 3600 + 5 * 60 + 9, units), '2 d 4 h 05 min 09 s');
  assert.equal(text(86400 + 7, units), '1 d 0 h 00 min 07 s');
  assert.equal(text(3600 + 61, units), '1 h 01 min 01 s');
  assert.equal(text(125, units), '2 min 05 s');
  assert.equal(text(0, units), '0 min 00 s');
});

test('the match card shows the kick-off in Madrid time, and only the day when the time is to be confirmed', () => {
  const strings = { timeZone: 'Europe/Madrid', localTime: 'Madrid time', tbd: 'TBC' };
  // 15:15 UTC on 1 November is 16:15 in Madrid (CET); 20:00 UTC on 1 August is 22:00 (CEST).
  assert.equal(cardDate({ date: '2026-11-01T15:15Z' }, 'en', strings), 'Sun, Nov 1, 16:15 (Madrid time)');
  assert.equal(cardDate({ date: '2026-08-01T20:00Z' }, 'en', strings), 'Sat, Aug 1, 22:00 (Madrid time)');
  // A placeholder time late in the UTC day would be the next day in Madrid; the day stays the listed one.
  const tbd = cardDate({ date: '2026-11-08T23:00Z', timeTbd: true }, 'en', strings);
  assert.equal(tbd, 'Sun, Nov 8 · TBC');
  assert.doesNotMatch(tbd, /Madrid|\d{2}:\d{2}/);
});
