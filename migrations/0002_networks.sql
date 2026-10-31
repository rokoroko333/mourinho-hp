-- Fan predictions: each vote also keeps a keyed hash of its IPv6 /48 (null for IPv4), so the votes per /48 per
-- match can be counted from the votes themselves (lib/predict.js, NETWORK_LIMIT). One write per vote, and the
-- count goes with the votes 30 days after kick-off. Never the address.
ALTER TABLE votes ADD COLUMN network TEXT;
CREATE INDEX IF NOT EXISTS votes_by_network ON votes (match_id, network);
