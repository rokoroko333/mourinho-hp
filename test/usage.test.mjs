import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { totalsOf, checkUsage, yesterday, run, LIMITS, WARN_AT, ACCOUNT_ID } from '../scripts/usage.mjs';

// The shape Cloudflare's GraphQL API answers (checked against the real account, 2026-11-01).
const answer = (over = {}) => ({
  data: { viewer: { accounts: [{
    workersInvocationsAdaptive: [{ sum: { requests: 72 } }],
    pagesFunctionsInvocationsAdaptiveGroups: [{ sum: { requests: 155 } }],
    kvOperationsAdaptiveGroups: [
      { sum: { requests: 60 }, dimensions: { actionType: 'read' } },
      { sum: { requests: 147 }, dimensions: { actionType: 'write' } },
      { sum: { requests: 1 }, dimensions: { actionType: 'list' } },
    ],
    d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 83, rowsWritten: 18 } }],
    ...over,
  }] } },
});

test('usage adds Workers and Pages Functions requests, and splits KV reads from writes', () => {
  assert.deepEqual(totalsOf(answer()), { requests: 227, kvRead: 60, kvWrite: 147, d1RowsRead: 83, d1RowsWritten: 18 });
  // A day with no D1 or no Functions at all is zero, not an error.
  assert.equal(totalsOf(answer({ d1AnalyticsAdaptiveGroups: [], pagesFunctionsInvocationsAdaptiveGroups: [] })).requests, 72);
});

test('usage refuses an error or empty answer instead of reading it as nothing used', () => {
  assert.throws(() => totalsOf({ errors: [{ message: 'not authorized' }] }), /not authorized/);
  assert.throws(() => totalsOf({ data: { viewer: { accounts: [] } } }), /no account/);
  assert.throws(() => totalsOf(null), /no account/);
  // A dataset missing from the answer, or a count that is not a number, is not a day without use.
  const missing = answer();
  delete missing.data.viewer.accounts[0].kvOperationsAdaptiveGroups;
  assert.throws(() => totalsOf(missing), /no kvOperationsAdaptiveGroups/);
  assert.throws(() => totalsOf(answer({ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: null, rowsWritten: 1 } }] })), /not a number/);
});

test('usage fails at 70% of any daily free limit', () => {
  assert.equal(WARN_AT, 0.7);
  const fine = checkUsage(totalsOf(answer()));
  assert.equal(fine.rows.length, Object.keys(LIMITS).length);
  assert.deepEqual(fine.over, []);
  const busy = checkUsage({ requests: 70_000, kvRead: 69_999, kvWrite: 700, d1RowsRead: 4_000_000, d1RowsWritten: 0 });
  assert.deepEqual(busy.over.map((r) => r.key), ['requests', 'kvWrite', 'd1RowsRead']);
});

test('usage checks the last whole UTC day, and the workflow passes the token from the repository secret', async () => {
  assert.equal(yesterday(new Date('2026-11-01T00:30:00Z')), '2026-10-31');
  assert.match(ACCOUNT_ID, /^[0-9a-f]{32}$/);
  const workflow = await readFile(new URL('../.github/workflows/usage.yml', import.meta.url), 'utf8');
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(workflow, /node scripts\/usage\.mjs/);
});

// The exit code is what makes GitHub send the email: every branch of it, through run() with a stand-in fetch.
test('usage exits 0 within the limits, 1 at 70% or more, 2 without a token or a readable answer', async () => {
  const quiet = { log: () => {}, error: () => {} };
  const answering = (body, status = 200) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  const day = '2026-10-30';
  assert.equal(await run({ token: 't', day, fetchImpl: answering(answer()), ...quiet }), 0);
  const busy = answer({ pagesFunctionsInvocationsAdaptiveGroups: [{ sum: { requests: 69_928 } }] }); // + 72 = 70,000
  assert.equal(await run({ token: 't', day, fetchImpl: answering(busy), ...quiet }), 1);
  assert.equal(await run({ token: '', day, fetchImpl: answering(answer()), ...quiet }), 2);
  assert.equal(await run({ token: 't', day, fetchImpl: answering({ errors: [{ message: 'denied' }] }), ...quiet }), 2);
  assert.equal(await run({ token: 't', day, fetchImpl: answering('busy', 503), ...quiet }), 2);
  assert.equal(await run({ token: 't', day, fetchImpl: answering('<html>not json</html>'), ...quiet }), 2);
  assert.equal(await run({ token: 't', day, fetchImpl: async () => { throw new Error('offline'); }, ...quiet }), 2);
  // It asks for that day, for that account, with the token.
  let sent;
  await run({ token: 'tok', day, accountId: 'acc', fetchImpl: async (url, init) => ((sent = init), new Response(JSON.stringify(answer()))), ...quiet });
  assert.equal(sent.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(sent.body).variables, { a: 'acc', d: day });
});
