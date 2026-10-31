// Fan predictions: one predicted score per connection per match, until kick-off, kept in D1 (binding VOTES,
// schema in migrations/). Used by functions/api/predict.js and by the cron Worker (purge). No personal data
// is stored: a connection is a keyed SHA-256 of its address (secret VOTE_SALT), per match for the vote and
// per 10-minute window for the burst limit, so neither can be traced back or joined across matches.
//
// A vote is a single write (one row in `votes`), so it cannot be half recorded. The tally is counted from
// those rows; 30 days after kick-off the purge moves the counts into `tallies` and deletes the rows in one
// batch (a D1 batch is a transaction), so the counts survive and nothing is counted twice.
import { TEAM_ID } from './feeds.js';

export const MAX_GOALS = 15;
export const BURST_LIMIT = 5; // new votes per connection per window, across matches
export const BURST_WINDOW_MS = 10 * 60 * 1000;
export const KEEP_DAYS = 30; // individual votes are deleted this long after kick-off; tallies stay
export const MIN_VOTES = 10; // below this the page shows no percentages (app.js), so a handful cannot look like a trend
// One IPv6 /48 (a site: a free tunnel broker hands out a whole /48, i.e. 65,536 /64 "connections") may cast at
// most this many votes per match. IPv4 has no such limit: each address costs, and mobile carriers put many
// visitors behind few addresses.
export const NETWORK_LIMIT = 50;
export const SUMMARY_TTL = 20; // seconds the tally is cached at the edge (cachedSummary)

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function keyedHash(secret, ...parts) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([secret, ...parts].join('|'))));
}

// The connection an address belongs to. An IPv6 user can pick any address in their /64, so IPv6 is cut to
// its first four groups (the network part); IPv4 stays whole, also when written as IPv6 (::ffff:1.2.3.4),
// which would otherwise put every such visitor in the one network 0:0:0:0.
export function connectionOf(address) {
  const a = String(address || '').trim().toLowerCase();
  const v4 = a.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  if (!a.includes(':')) return a;
  const [head, tail = ''] = a.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => (g || '0').replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// The IPv6 /48 an address belongs to (first three groups), or null for IPv4.
export function networkOf(address) {
  const conn = connectionOf(address);
  return conn.endsWith('::/64') ? `${conn.split(':').slice(0, 3).join(':')}::/48` : null;
}

// Which side Real Madrid (TEAM_ID) is on, so outcomes read "win / draw / loss" for the club.
const clubIsHome = (m) => String(m.home?.id) === String(TEAM_ID);
const clubSide = (m) => (clubIsHome(m) ? 'home' : String(m.away?.id) === String(TEAM_ID) ? 'away' : null);

export function outcomeOf(m, home, away) {
  const side = clubSide(m);
  if (!side || home === away) return home === away ? 'draw' : null;
  const club = side === 'home' ? home : away;
  const other = side === 'home' ? away : home;
  return club > other ? 'win' : 'loss';
}

// The match a vote may be for: the next fixture from the matches KV, with a set kick-off still ahead.
export function openMatch(matches, id, now = Date.now()) {
  const m = matches?.next;
  if (!m || String(m.id) !== String(id)) return { error: 'unknown match', status: 404 };
  // A kick-off that does not parse would never close voting (NaN <= now is false), so it is treated as not set.
  if (m.timeTbd || !Number.isFinite(Date.parse(m.date))) return { error: 'kick-off time not set', status: 409 };
  if (Date.parse(m.date) <= now) return { error: 'closed at kick-off', status: 409 };
  if (!clubSide(m)) return { error: 'club not in this match', status: 409 };
  return { match: m };
}

// Numbers only, as app.js sends them: null, "", true or "1" are refused rather than read as 0 or 1.
export function parseScore(body) {
  const ok = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_GOALS;
  const { home, away } = body || {};
  return ok(home) && ok(away) ? { home, away } : null;
}

// Records a vote. Returns { recorded: true } or { recorded: false, reason } ('duplicate' | 'burst').
// A repeat from a connection that has already voted is answered as a duplicate before the burst count, so
// re-sending (or a shared connection's second visitor) does not use up the limit.
export async function recordVote(db, { secret, address, match, home, away, now = Date.now() }) {
  const conn = connectionOf(address);
  const voter = await keyedHash(secret, 'vote', String(match.id), conn);
  const seen = await db.prepare('SELECT 1 AS seen FROM votes WHERE match_id = ?1 AND voter = ?2').bind(String(match.id), voter).first();
  if (seen) return { recorded: false, reason: 'duplicate' };
  const window = String(Math.floor(now / BURST_WINDOW_MS));
  const burst = await db
    .prepare('INSERT INTO bursts (window, voter, n) VALUES (?1, ?2, 1) ON CONFLICT (window, voter) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(window, await keyedHash(secret, 'burst', window, conn))
    .first();
  if (burst?.n > BURST_LIMIT) return { recorded: false, reason: 'burst' };
  const net = networkOf(address);
  if (net) {
    const used = await db
      .prepare('INSERT INTO networks (match_id, network, n, created_at) VALUES (?1, ?2, 1, ?3) ON CONFLICT (match_id, network) DO UPDATE SET n = n + 1 RETURNING n')
      .bind(String(match.id), await keyedHash(secret, 'network', String(match.id), net), new Date(now).toISOString())
      .first();
    if (used?.n > NETWORK_LIMIT) return { recorded: false, reason: 'network' };
  }
  // The kick-off is stored normalised, so the purge's text comparison (kickoff < cutoff) holds whatever form
  // the feed used.
  const inserted = await db
    .prepare('INSERT OR IGNORE INTO votes (match_id, voter, home, away, kickoff, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(String(match.id), voter, home, away, new Date(match.date).toISOString(), new Date(now).toISOString())
    .run();
  return inserted.meta?.changes ? { recorded: true } : { recorded: false, reason: 'duplicate' };
}

// The public summary for a match: total, win/draw/loss for the club, the three most picked scores, and,
// once the result is in the matches KV, the result and how many picked it exactly. Counts are the purged
// tallies plus the votes still kept.
export async function summary(db, matches, id) {
  const m = [matches?.next, ...(matches?.results || []), ...(matches?.fixtures || [])].find((x) => x && String(x.id) === String(id));
  if (!m) return null;
  const { results = [] } = await db
    .prepare(
      `SELECT home, away, SUM(n) AS votes FROM (
         SELECT home, away, votes AS n FROM tallies WHERE match_id = ?1
         UNION ALL SELECT home, away, COUNT(*) AS n FROM votes WHERE match_id = ?1 GROUP BY home, away
       ) GROUP BY home, away`,
    )
    .bind(String(id))
    .all();
  const total = results.reduce((n, r) => n + r.votes, 0);
  const outcomes = { win: 0, draw: 0, loss: 0 };
  for (const r of results) {
    const o = outcomeOf(m, r.home, r.away);
    if (o) outcomes[o] += r.votes;
  }
  const top = [...results].sort((a, b) => b.votes - a.votes || a.home - b.home || a.away - b.away).slice(0, 3);
  const out = { match: String(id), total, outcomes, top, clubIsHome: clubIsHome(m), kickoff: m.date, minVotes: MIN_VOTES };
  if (m.completed && m.home?.score != null && m.away?.score != null) {
    const home = Number(m.home.score);
    const away = Number(m.away.score);
    out.result = { home, away, outcome: outcomeOf(m, home, away), hits: results.find((r) => r.home === home && r.away === away)?.votes || 0 };
  }
  return out;
}

// The summary through the colo's edge cache for SUMMARY_TTL seconds, keyed on the match id only, so the D1
// count runs at most once per colo per SUMMARY_TTL however often the page is loaded. Errors are not cached.
export async function cachedSummary({ request, env, waitUntil }, matches, id) {
  const key = new Request(`${new URL(request.url).origin}/__summary/${encodeURIComponent(id)}`);
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const hit = cache && (await cache.match(key));
  if (hit) return hit.json();
  const out = await summary(env.VOTES, matches, id);
  if (out && cache) waitUntil(cache.put(key, new Response(JSON.stringify(out), { headers: { 'Cache-Control': `max-age=${SUMMARY_TTL}` } })));
  return out;
}

// Run by the cron Worker: 30 days after kick-off, move the counts into `tallies` and delete the votes, in
// one batch (all or nothing); and drop old burst windows.
export async function purge(db, now = Date.now()) {
  const cutoff = new Date(now - KEEP_DAYS * 24 * 3600 * 1000).toISOString();
  const [, votes] = await db.batch([
    db
      .prepare(
        `INSERT INTO tallies (match_id, home, away, votes)
         SELECT match_id, home, away, COUNT(*) FROM votes WHERE kickoff < ?1 GROUP BY match_id, home, away
         ON CONFLICT (match_id, home, away) DO UPDATE SET votes = votes + excluded.votes`,
      )
      .bind(cutoff),
    db.prepare('DELETE FROM votes WHERE kickoff < ?1').bind(cutoff),
  ]);
  const windows = await db.prepare('DELETE FROM bursts WHERE CAST(window AS INTEGER) < ?1').bind(Math.floor(now / BURST_WINDOW_MS) - 1).run();
  const nets = await db.prepare('DELETE FROM networks WHERE created_at < ?1').bind(cutoff).run();
  return { votesDeleted: votes.meta?.changes || 0, burstsDeleted: windows.meta?.changes || 0, networksDeleted: nets.meta?.changes || 0 };
}
