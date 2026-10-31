// Checks that production is still being refreshed, so a stopped or failing cron is noticed instead of the
// site quietly serving old news and a "next match" that has already been played (maintenance review).
//
//   npm run health                                   # production (SITE_URL, or the pages.dev address)
//   npm run health -- --base http://localhost:8788   # another origin
//
// .github/workflows/health.yml runs it every hour. A failed run makes GitHub email the owner.
// It reads /api/home once (a GET, the same request every page makes) and fails when:
// - the news list or the matches have not been written for MAX_AGE_MS, or are missing;
// - either was fetched on the spot instead of read from KV (`live`, lib/serve.js readFeed), which would hide a
//   stopped cron behind a fresh date;
// - the answer is not JSON.
// The cron runs every 20 minutes, so two hours means about six missed or failed runs in a row, not one bad
// moment upstream. When matches alone are old, the cause is usually ESPN (lib/feeds.js fetchMatches keeps the
// last copy when any of its lists fails). The Worker's log says why: Workers Logs in the dashboard, or
// `npx wrangler tail --config workers/feeds/wrangler.toml`.
// Exit code: 0 healthy, 1 a problem was found (the problems are printed), 2 bad arguments.

import { pathToFileURL } from 'node:url';

export const MAX_AGE_MS = 2 * 3600 * 1000;

// The problems in an /api/home answer, as sentences; an empty list means healthy.
export function checkHome(body, now = new Date()) {
  const problems = [];
  for (const key of ['news', 'matches']) {
    const part = body?.[key];
    if (!part) {
      problems.push(`${key}: missing`);
      continue;
    }
    const at = Date.parse(part.updatedAt);
    // Fetched on the spot because KV was empty or unreachable: the date says nothing about the cron.
    if (part.live) problems.push(`${key}: served live, not from the cron's copy in KV (KV empty or unreachable)`);
    if (Number.isNaN(at)) problems.push(`${key}: no updatedAt`);
    else if (now - at > MAX_AGE_MS) problems.push(`${key}: last written ${part.updatedAt}, ${Math.round((now - at) / 60000)} minutes ago`);
  }
  if (body?.news && !body.news.items?.length) problems.push('news: no items');
  return problems;
}

async function main() {
  const i = process.argv.indexOf('--base');
  if (i > 0 && !process.argv[i + 1]) {
    console.error('usage: npm run health -- --base <origin>');
    process.exit(2);
  }
  const base = (i > 0 ? process.argv[i + 1] : process.env.SITE_URL || 'https://infinito-mourinho.pages.dev').replace(/\/$/, '');
  const url = `${base}/api/home?lang=en`;
  // One retry, so a single network hiccup between GitHub and Cloudflare does not send an email.
  let problems;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      problems = res.ok ? checkHome(await res.json()) : [`${url}: HTTP ${res.status}`];
    } catch (err) {
      problems = [`${url}: ${err.message}`];
    }
    if (!problems.length) break;
    if (!attempt) await new Promise((r) => setTimeout(r, 30_000));
  }
  if (problems.length) {
    console.error(`UNHEALTHY ${url}\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`OK ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
