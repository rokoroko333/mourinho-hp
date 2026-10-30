-- Fan predictions (lib/predict.js). No personal data: `voter` is a keyed hash of the address and the match,
-- so it only answers "has this connection already voted on this match"; it cannot be turned back into an IP.
CREATE TABLE IF NOT EXISTS votes (
  match_id TEXT NOT NULL,
  voter TEXT NOT NULL,
  home INTEGER NOT NULL,
  away INTEGER NOT NULL,
  kickoff TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (match_id, voter)
);
-- Kept after the votes are deleted (30 days after kick-off): the counts per predicted score.
CREATE TABLE IF NOT EXISTS tallies (
  match_id TEXT NOT NULL,
  home INTEGER NOT NULL,
  away INTEGER NOT NULL,
  votes INTEGER NOT NULL,
  PRIMARY KEY (match_id, home, away)
);
-- Votes per connection per 10-minute window, to refuse bursts (also a keyed hash, and short-lived).
CREATE TABLE IF NOT EXISTS bursts (
  window TEXT NOT NULL,
  voter TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (window, voter)
);
CREATE INDEX IF NOT EXISTS votes_by_kickoff ON votes (kickoff);
