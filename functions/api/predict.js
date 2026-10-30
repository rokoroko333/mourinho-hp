// Fan predictions (lib/predict.js). GET ?match=<id> returns the tally; POST { match, home, away } records one
// prediction per connection per match until kick-off. The match must be the next fixture in the matches KV.
import { KV_KEYS } from '../../lib/feeds.js';
import { openMatch, parseScore, recordVote, summary } from '../../lib/predict.js';

const json = (body, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
  });

const readMatches = async (env) => JSON.parse((await env.FEEDS.get(KV_KEYS.matches)) || 'null');

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('match');
  if (!id || !/^\d{1,12}$/.test(id) || !env.VOTES) return json({ error: 'bad request' }, 400);
  const out = await summary(env.VOTES, await readMatches(env), id);
  return out ? json(out, 200, 15) : json({ error: 'unknown match' }, 404);
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
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const r = await recordVote(env.VOTES, { secret: env.VOTE_SALT, address, match: open.match, ...score });
  if (!r.recorded && r.reason === 'burst') return json({ error: 'too many' }, 429);
  return json({ recorded: r.recorded, duplicate: r.reason === 'duplicate', ...(await summary(env.VOTES, matches, open.match.id)) });
}
