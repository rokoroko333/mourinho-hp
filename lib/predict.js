// Fan predictions: one predicted score per connection per match, until kick-off, kept in D1 (binding VOTES,
// schema in migrations/). Used by functions/api/predict.js and by the cron Worker (purge). No personal data
// is stored: a connection is a keyed SHA-256 of its address (secret VOTE_SALT), per match for the vote and
// per 10-minute window for the burst limit, so neither can be traced back or joined across matches.
import { TEAM_ID } from './feeds.js';

export const MAX_GOALS = 15;
export const BURST_LIMIT = 5; // votes per connection per window, across matches
export const BURST_WINDOW_MS = 10 * 60 * 1000;
export const KEEP_DAYS = 30; // individual votes are deleted this long after kick-off; tallies stay
export const MIN_VOTES = 10; // below this the page shows no percentages (app.js), so a handful cannot look like a trend

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function keyedHash(secret, ...parts) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([secret, ...parts].join('|'))));
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
  if (m.timeTbd) return { error: 'kick-off time not set', status: 409 };
  if (new Date(m.date).getTime() <= now) return { error: 'closed at kick-off', status: 409 };
  if (!clubSide(m)) return { error: 'club not in this match', status: 409 };
  return { match: m };
}

export function parseScore(body) {
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_GOALS;
  const home = Number(body?.home);
  const away = Number(body?.away);
  return ok(home) && ok(away) ? { home, away } : null;
}

// Records a vote. Returns { recorded: true } or { recorded: false, reason } ('duplicate' | 'burst').
export async function recordVote(db, { secret, address, match, home, away, now = Date.now() }) {
  const window = String(Math.floor(now / BURST_WINDOW_MS));
  const burstVoter = await keyedHash(secret, 'burst', window, address);
  const burst = await db
    .prepare('INSERT INTO bursts (window, voter, n) VALUES (?1, ?2, 1) ON CONFLICT (window, voter) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(window, burstVoter)
    .first();
  if (burst?.n > BURST_LIMIT) return { recorded: false, reason: 'burst' };
  const voter = await keyedHash(secret, 'vote', String(match.id), address);
  const inserted = await db
    .prepare('INSERT OR IGNORE INTO votes (match_id, voter, home, away, kickoff, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(String(match.id), voter, home, away, match.date, new Date(now).toISOString())
    .run();
  if (!inserted.meta?.changes) return { recorded: false, reason: 'duplicate' };
  await db
    .prepare('INSERT INTO tallies (match_id, home, away, votes) VALUES (?1, ?2, ?3, 1) ON CONFLICT (match_id, home, away) DO UPDATE SET votes = votes + 1')
    .bind(String(match.id), home, away)
    .run();
  return { recorded: true };
}

// The public summary for a match: total, win/draw/loss for the club, the three most picked scores, and,
// once the result is in the matches KV, the result and how many picked it exactly.
export async function summary(db, matches, id) {
  const m = [matches?.next, ...(matches?.results || []), ...(matches?.fixtures || [])].find((x) => x && String(x.id) === String(id));
  if (!m) return null;
  const { results = [] } = await db.prepare('SELECT home, away, votes FROM tallies WHERE match_id = ?1').bind(String(id)).all();
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

// Run by the cron Worker: drop individual votes 30 days after kick-off (the tallies stay) and old burst windows.
export async function purge(db, now = Date.now()) {
  const cutoff = new Date(now - KEEP_DAYS * 24 * 3600 * 1000).toISOString();
  const votes = await db.prepare('DELETE FROM votes WHERE kickoff < ?1').bind(cutoff).run();
  const windows = await db.prepare('DELETE FROM bursts WHERE CAST(window AS INTEGER) < ?1').bind(Math.floor(now / BURST_WINDOW_MS) - 1).run();
  return { votesDeleted: votes.meta?.changes || 0, burstsDeleted: windows.meta?.changes || 0 };
}
