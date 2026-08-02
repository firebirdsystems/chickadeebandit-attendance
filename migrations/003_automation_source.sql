-- Automations schedule a session on a leader's behalf
-- (manifest.automation_actions.add_session).
--
-- `source_event_id` records which app event produced the row. The dispatcher's
-- dedupe guard reads it before running an action (SELECT 1 ... WHERE
-- source_event_id = ? LIMIT 1), so one event can never be applied twice --
-- neither by a retry nor by two rules pointed at the same trigger.
--
-- Nullable on purpose: every session the app's own UI or the series stamper
-- creates leaves it NULL.
ALTER TABLE app_attendance__events ADD COLUMN source_event_id TEXT;

CREATE INDEX IF NOT EXISTS app_attendance__events_source_event_idx
  ON app_attendance__events (source_event_id);
