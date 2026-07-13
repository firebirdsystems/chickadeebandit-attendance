-- Attendance — roll call for club/troop meetings and practices.
--
-- Access: both tables are `adult_writable` (manifest.json) — every member can
-- see the attendance history (their own and the group's), only adults (the
-- leaders) may create events or mark attendance. Attendance status is group
-- knowledge in a club context, not confidential.
--
-- One record per (event, member) is enforced by the UNIQUE index; the app
-- upserts via ON CONFLICT DO UPDATE when a leader re-marks someone.
--
-- Plaintext columns (manifest db_plaintext_columns): `event_date` and
-- `start_time` — the schedule sorts on them in SQL. `status` (present|absent|
-- excused|late) is a hub built-in plaintext column. Titles/locations/notes
-- stay encrypted at rest.
CREATE TABLE IF NOT EXISTS app_attendance__events (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,                 -- "July pack meeting"
  kind       TEXT NOT NULL DEFAULT 'meeting', -- display only: meeting|practice|service|other
  event_date TEXT NOT NULL,                 -- ISO YYYY-MM-DD
  start_time TEXT NOT NULL DEFAULT '',      -- "18:30"
  location   TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_attendance__records (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  member_id   TEXT NOT NULL,                -- who the mark is about
  status      TEXT NOT NULL DEFAULT 'present', -- present|absent|excused|late
  note        TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,                -- the leader who marked it
  created_at  TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES app_attendance__events(id) ON DELETE CASCADE,
  UNIQUE (event_id, member_id)
);

CREATE INDEX IF NOT EXISTS app_attendance__events_date_idx
  ON app_attendance__events (event_date, start_time);

CREATE INDEX IF NOT EXISTS app_attendance__records_event_idx
  ON app_attendance__records (event_id);

CREATE INDEX IF NOT EXISTS app_attendance__records_member_idx
  ON app_attendance__records (member_id);
