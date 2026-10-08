-- Finished tests. One never changes once taken, so a push only ever adds them. The score is in columns as well as in
-- `data`, so where someone's first attempt at a test falls among everyone's can be worked out in SQL.
CREATE TABLE IF NOT EXISTS tests (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  test TEXT NOT NULL,
  finished INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  total INTEGER NOT NULL,
  right INTEGER NOT NULL,
  data TEXT NOT NULL,
  synced INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS tests_synced ON tests (user_id, synced);
CREATE INDEX IF NOT EXISTS tests_test ON tests (test, finished);
