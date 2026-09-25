-- Undone reviews, so devices that already pulled one delete it too, and a late re-push can't bring it back.
CREATE TABLE IF NOT EXISTS revlog_deleted (
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  review INTEGER NOT NULL,
  synced INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id, review)
);
CREATE INDEX IF NOT EXISTS revlog_deleted_synced ON revlog_deleted (user_id, synced);
