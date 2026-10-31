// Checks yesterday's use of the Cloudflare free plan's daily limits, so the owner hears well before a limit stops
// the site's live parts (the free limits reset at 00:00 UTC; past one, that part stops until the next day).
//
//   CLOUDFLARE_API_TOKEN=<token> npm run usage            # yesterday (UTC)
//   CLOUDFLARE_API_TOKEN=<token> npm run usage -- 2026-11-01
//
// .github/workflows/usage.yml runs it every day. A failed run makes GitHub email the owner. The token needs only
// "Account Analytics: Read" (README, "Free-plan usage"). It fails when any limit was used to WARN_AT or more; the table
// it prints, and README "Free plan budget", say what to do (most often: move to Workers Paid, $5 a month).
// Exit code: 0 within the limits, 1 a limit at WARN_AT or more, 2 setup or API error.
import { pathToFileURL } from 'node:url';

export const ACCOUNT_ID = 'd7720aa7ba522d9b7cc837974fb84f0f';
export const WARN_AT = 0.7;
// The free plan's daily limits (developers.cloudflare.com/workers/platform/pricing, checked 2026-11-01). This is
// the one place they are written; README "Free plan budget" refers here. Pages Functions are billed as Workers, so
// the two share one request limit. The two datasets do not overlap: on the real account the Workers one lists only
// the cron Worker (and a few calls named __unknown__), the Pages one the Functions.
export const LIMITS = {
  requests: { label: 'Workers + Pages Functions requests', limit: 100_000 },
  kvRead: { label: 'KV reads', limit: 100_000 },
  kvWrite: { label: 'KV writes', limit: 1_000 },
  d1RowsRead: { label: 'D1 rows read', limit: 5_000_000 },
  d1RowsWritten: { label: 'D1 rows written', limit: 100_000 },
};

export const QUERY = `query($a: String!, $d: Date!) { viewer { accounts(filter: { accountTag: $a }) {
  workersInvocationsAdaptive(limit: 1000, filter: { date: $d }) { sum { requests } }
  pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: { date: $d }) { sum { requests } }
  kvOperationsAdaptiveGroups(limit: 1000, filter: { date: $d }) { sum { requests } dimensions { actionType } }
  d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date: $d }) { sum { rowsRead rowsWritten } }
} } }`;

// The day's totals from the GraphQL answer. Throws on an error answer, so a broken token or query is not read as
// "nothing used".
export function totalsOf(answer) {
  if (answer?.errors?.length) throw new Error(answer.errors.map((e) => e.message).join('; '));
  const a = answer?.data?.viewer?.accounts?.[0];
  if (!a) throw new Error('no account in the answer (wrong account id, or the token cannot read it)');
  // An empty list is a day without use; a missing list (or a value that is not a number) means the answer changed
  // or the token cannot see that dataset, which must not read as zero.
  for (const k of ['workersInvocationsAdaptive', 'pagesFunctionsInvocationsAdaptiveGroups', 'kvOperationsAdaptiveGroups', 'd1AnalyticsAdaptiveGroups']) {
    if (!Array.isArray(a[k])) throw new Error(`no ${k} in the answer`);
  }
  const sum = (rows, f) =>
    rows.reduce((n, r) => {
      const v = f(r);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`not a number in the answer: ${JSON.stringify(r)}`);
      return n + v;
    }, 0);
  const kv = (type) => sum(a.kvOperationsAdaptiveGroups.filter((r) => r.dimensions?.actionType === type), (r) => r.sum?.requests);
  return {
    requests: sum(a.workersInvocationsAdaptive, (r) => r.sum?.requests) + sum(a.pagesFunctionsInvocationsAdaptiveGroups, (r) => r.sum?.requests),
    kvRead: kv('read'),
    kvWrite: kv('write'),
    d1RowsRead: sum(a.d1AnalyticsAdaptiveGroups, (r) => r.sum?.rowsRead),
    d1RowsWritten: sum(a.d1AnalyticsAdaptiveGroups, (r) => r.sum?.rowsWritten),
  };
}

// One row per limit, with the share used, and the ones at WARN_AT or more.
export function checkUsage(totals) {
  const rows = Object.entries(LIMITS).map(([key, { label, limit }]) => ({ key, label, used: totals[key] ?? 0, limit, share: (totals[key] ?? 0) / limit }));
  return { rows, over: rows.filter((r) => r.share >= WARN_AT) };
}

export const yesterday = (now = new Date()) => new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);

// The whole check, returning the exit code (0 within the limits, 1 at WARN_AT or more, 2 setup or API error).
// `fetchImpl` and the environment come in as arguments, so the tests can check every exit code.
export async function run({ token, day, accountId = ACCOUNT_ID, fetchImpl = fetch, log = console.log, error = console.error }) {
  if (!token) {
    error('CLOUDFLARE_API_TOKEN is not set (README, "Free-plan usage": an API token with Account Analytics: Read).');
    return 2;
  }
  let totals;
  try {
    const res = await fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { a: accountId, d: day } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    totals = totalsOf(await res.json());
  } catch (err) {
    error(`Could not read the usage for ${day}: ${err.message}`);
    return 2;
  }
  const { rows, over } = checkUsage(totals);
  log(`Cloudflare free plan, ${day} (UTC):`);
  for (const r of rows) log(`  ${r.share >= WARN_AT ? '!!' : '  '} ${r.label.padEnd(36)} ${String(r.used).padStart(10)} / ${r.limit} (${(r.share * 100).toFixed(1)}%)`);
  if (over.length) {
    error(`\n${over.map((r) => r.label).join(', ')} at ${WARN_AT * 100}% or more of the daily free limit. See README "Free plan budget".`);
    return 1;
  }
  return 0;
}

async function main() {
  const day = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || yesterday();
  process.exit(await run({ token: process.env.CLOUDFLARE_API_TOKEN, day, accountId: process.env.CLOUDFLARE_ACCOUNT_ID || ACCOUNT_ID }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
