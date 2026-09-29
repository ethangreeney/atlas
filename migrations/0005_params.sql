-- The FSRS weights fitted to a learner's answers, so every device schedules with the same ones. One row per account;
-- a fit replaces it only if it saw more reviews (or as many, fitted later).
CREATE TABLE IF NOT EXISTS params (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  reviews INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  synced INTEGER NOT NULL
);
