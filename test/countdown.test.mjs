import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// src/assets/countdown.js is a plain browser script that sets globalThis.mourinhoCountdown; run it alone.
const sandbox = {};
runInNewContext(await readFile(new URL('../src/assets/countdown.js', import.meta.url), 'utf8'), sandbox);
const { kickoffOf, text } = sandbox.mourinhoCountdown;
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
