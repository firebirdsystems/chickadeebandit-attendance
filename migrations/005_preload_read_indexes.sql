-- Index the manifest `preload` read, which the hub runs server-side while
-- rendering this app's document — on every launch, for every household.
--
-- preload.series orders by created_at and caps at 100. Without this index the
-- planner sorted every series row in the household to hand back the newest 100;
-- with it the scan walks the index and stops at 100. created_at is plaintext at
-- rest (the codec never encrypts a *_at column), so it sorts as written.
CREATE INDEX IF NOT EXISTS app_attendance__series_created_idx
  ON app_attendance__series (created_at DESC);
