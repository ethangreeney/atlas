-- Server-side receipt time, so devices that were offline still get every row on their next pull.
ALTER TABLE cards ADD COLUMN synced INTEGER NOT NULL DEFAULT 0;
ALTER TABLE days ADD COLUMN synced INTEGER NOT NULL DEFAULT 0;
ALTER TABLE revlog ADD COLUMN synced INTEGER NOT NULL DEFAULT 0;
UPDATE cards SET synced = updated;
UPDATE days SET synced = updated;
UPDATE revlog SET synced = review;
CREATE INDEX IF NOT EXISTS cards_synced ON cards (user_id, synced);
CREATE INDEX IF NOT EXISTS days_synced ON days (user_id, synced);
CREATE INDEX IF NOT EXISTS revlog_synced ON revlog (user_id, synced);
