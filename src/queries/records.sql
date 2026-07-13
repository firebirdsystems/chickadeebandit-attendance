-- AI read export: raw attendance marks (join to events client-side).
-- status is the hub built-in plaintext column.
SELECT
  id,
  event_id,
  member_id,
  status,
  recorded_by
FROM app_attendance__records
ORDER BY created_at DESC
LIMIT 1000
