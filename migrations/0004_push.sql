-- Daily reminder subscriptions (Web Push). One row per browser per account; `hour` is local to `tz`, and
-- `last_sent_day` is the local day key (4am rollover) of the last reminder, so each day gets at most one.
CREATE TABLE IF NOT EXISTS push_subs (
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  tz TEXT NOT NULL,
  hour INTEGER NOT NULL,
  last_sent_day TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS push_subs_endpoint ON push_subs (endpoint);
