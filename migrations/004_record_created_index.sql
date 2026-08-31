-- records orders by created_at DESC under LIMIT 1000. created_at is plaintext by
-- the _at suffix rule. Attendance marks accumulate with every event, so this is
-- the one table here that grows without bound — the scan it replaces is the
-- whole history on every app launch.
CREATE INDEX IF NOT EXISTS app_attendance__records_created_idx
  ON app_attendance__records(created_at);
