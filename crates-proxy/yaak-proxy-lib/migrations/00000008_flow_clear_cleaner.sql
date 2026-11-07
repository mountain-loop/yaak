-- One process deletes cleared flows at a time: `cleaner` names it, and `cleaner_at` (unix
-- milliseconds) is when it last went on, so another takes over once that is long past.
ALTER TABLE flow_clear_mark ADD COLUMN cleaner TEXT;
ALTER TABLE flow_clear_mark ADD COLUMN cleaner_at INTEGER;
