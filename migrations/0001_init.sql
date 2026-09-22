CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  picture TEXT,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS cards_updated ON cards (user_id, updated);
CREATE TABLE IF NOT EXISTS days (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS days_updated ON days (user_id, updated);
CREATE TABLE IF NOT EXISTS revlog (
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  review INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id, review)
);
