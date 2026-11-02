-- Daily reminders were removed: their subscriptions go with them.
DROP INDEX IF EXISTS push_subs_endpoint;
DROP TABLE IF EXISTS push_subs;
