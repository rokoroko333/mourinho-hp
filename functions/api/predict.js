// Fan predictions (lib/predict.js). GET ?match=<id> returns the tally; POST { match, home, away } records one
// prediction per connection per match until kick-off. The match must be the next fixture in the matches KV.
import { KV_KEYS } from '../../lib/feeds.js';
import { SUMMARY_TTL, cachedSummary, openMatch, parseScore, recordVote, summary } from '../../lib/predict.js';
import { json as apiJson } from '../../lib/serve.js';

const json = (body, status = 200, maxAge = 0) => apiJson(body, status, maxAge, maxAge);

const readMatches = async (env) => JSON.parse((await env.FEEDS.get(KV_KEYS.matches)) || 'null');

// The tally is read from D1 at most once per SUMMARY_TTL per colo (cachedSummary), so reloading the page
// cannot run the D1 count over and over and use up the daily read quota. Old app.js only (one deploy):
// the pages now read the tally from /api/home.
export async function onRequestGet({ request, env, waitUntil }) {
  const id = new URL(request.url).searchParams.get('match');
  if (!id || !/^\d{1,12}$/.test(id) || !env.VOTES) return json({ error: 'bad request' }, 400);
  try {
    const out = await cachedSummary({ request, env, waitUntil }, await readMatches(env), id);
    return out ? json(out, 200, SUMMARY_TTL) : json({ error: 'unknown match' }, 404);
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  // Same-site JSON only: another site's form cannot send application/json without a preflight we never answer.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'forbidden' }, 403);
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ error: 'json only' }, 415);
  if (!env.VOTES || !env.VOTE_SALT) return json({ error: 'unavailable' }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const score = parseScore(body);
  if (!score) return json({ error: 'bad score' }, 400);
  const matches = await readMatches(env);
  const open = openMatch(matches, body?.match);
  if (open.error) return json({ error: open.error }, open.status);
  // Cloudflare always sends the visitor's address. Without it every visitor would share one "connection",
  // so the vote is refused rather than counted; only the local dev server (no Cloudflare in front) stands in.
  const local = new URL(request.url).hostname === 'localhost';
  const address = request.headers.get('CF-Connecting-IP') || (local ? '127.0.0.1' : null);
  if (!address) return json({ error: 'unavailable' }, 503);
  try {
    const r = await recordVote(env.VOTES, { secret: env.VOTE_SALT, address, match: open.match, ...score });
    if (!r.recorded && (r.reason === 'burst' || r.reason === 'network')) return json({ error: 'too many' }, 429);
    return json({ recorded: r.recorded, duplicate: r.reason === 'duplicate', ...(await summary(env.VOTES, matches, open.match.id)) });
  } catch {
    // D1 unavailable or over its daily quota: nothing was recorded that the visitor can see; they can try later.
    return json({ error: 'unavailable' }, 503);
  }
}
