-- Attendance 1.1.0 — recurring series.
--
-- A series is a weekly rule ("every Tuesday 6:00 PM practice"). The app
-- materializes real `events` rows from it, ~28 days ahead, on load — apps have
-- no server code, so stamping happens client-side. Marks attach to the stamped
-- events like any other, and the Today/agenda surface (added in manifest.json)
-- only sees real rows, so the sessions have to exist.
--
-- Idempotency: a partial UNIQUE index on (series_id, event_date) makes
-- re-stamping a no-op via INSERT OR IGNORE. Editing a series deletes its
-- FUTURE, still-UNMARKED events and re-stamps; past and already-marked
-- sessions are never touched.
--
-- Access: `series` is `adult_writable` like events/records (manifest.json) —
-- leaders define the schedule, everyone reads it. Read-open is also what the
-- agenda surface requires. Plaintext columns come free from the *_date / *_id
-- suffix skip-list, so no db_plaintext_columns change is needed (rule
-- expansion happens in JS over decrypted rows; agenda/glance only touch the
-- already-plaintext event_date / start_time).
CREATE TABLE IF NOT EXISTS app_attendance__series (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,                  -- "Tuesday practice"
  kind           TEXT NOT NULL DEFAULT 'practice', -- meeting|practice|service|other
  weekday        INTEGER NOT NULL,               -- 0=Sun .. 6=Sat
  interval_weeks INTEGER NOT NULL DEFAULT 1,     -- 1=weekly, 2=biweekly, …
  start_time     TEXT NOT NULL DEFAULT '',       -- "18:00"
  location       TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  start_date     TEXT NOT NULL,                  -- ISO YYYY-MM-DD; phase anchor
  end_date       TEXT NOT NULL DEFAULT '',       -- ISO YYYY-MM-DD or '' (open-ended)
  active         INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- Link a stamped event back to its series (NULL for one-off events).
ALTER TABLE app_attendance__events ADD COLUMN series_id TEXT DEFAULT NULL;

-- One event per (series, date): makes INSERT OR IGNORE re-stamping idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS app_attendance__events_series_occurrence_idx
  ON app_attendance__events (series_id, event_date) WHERE series_id IS NOT NULL;
