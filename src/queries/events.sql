-- AI read export: events newest first.
-- adult_writable reads are open, so no member_id is required.
-- event_date / start_time are declared in db_plaintext_columns.
SELECT
  id,
  title,
  kind,
  event_date,
  start_time,
  location
FROM app_attendance__events
ORDER BY event_date DESC
LIMIT 200
