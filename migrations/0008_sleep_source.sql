-- Where a night's sleep came from: the nightly Shortcut ('sync') or typed on the Brain page ('manual').
-- A typed night is never overwritten by the sync.
ALTER TABLE sleep ADD COLUMN source TEXT NOT NULL DEFAULT 'sync' CHECK (source IN ('sync', 'manual'));
