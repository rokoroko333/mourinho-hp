-- Fan predictions: the running count of each predicted score per match, kept up to date by a trigger on every
-- new vote, so the summary reads a few rows per match instead of counting every vote on each read (D1's free plan
-- allows 5 million rows read a day; counting votes would pass that at about 170 votes a match and 15,000 visits a
-- day). A vote stays a single statement: the trigger runs inside it, and an ignored duplicate fires nothing.
-- `tallies` (0001) is no longer written or read; it stays so older code keeps working until it is replaced.
CREATE TABLE IF NOT EXISTS counts (
  match_id TEXT NOT NULL,
  home INTEGER NOT NULL,
  away INTEGER NOT NULL,
  votes INTEGER NOT NULL,
  PRIMARY KEY (match_id, home, away)
);
-- Everything counted so far: the purged tallies plus the votes still kept.
INSERT INTO counts (match_id, home, away, votes)
  SELECT match_id, home, away, SUM(n) FROM (
    SELECT match_id, home, away, votes AS n FROM tallies
    UNION ALL SELECT match_id, home, away, COUNT(*) AS n FROM votes GROUP BY match_id, home, away
  ) GROUP BY match_id, home, away
  ON CONFLICT (match_id, home, away) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS votes_count AFTER INSERT ON votes BEGIN
  INSERT INTO counts (match_id, home, away, votes) VALUES (NEW.match_id, NEW.home, NEW.away, 1)
  ON CONFLICT (match_id, home, away) DO UPDATE SET votes = votes + 1;
END;
