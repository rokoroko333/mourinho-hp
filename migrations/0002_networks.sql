-- Fan predictions: votes per IPv6 /48 per match (lib/predict.js, NETWORK_LIMIT). `network` is a keyed hash of the
-- /48, never the address. Rows go with the purge, 30 days after they were written.
CREATE TABLE IF NOT EXISTS networks (
  match_id TEXT NOT NULL,
  network TEXT NOT NULL,
  n INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (match_id, network)
);
