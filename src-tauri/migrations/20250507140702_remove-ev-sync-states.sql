-- There used to be sync code that skipped over environments because we didn't
-- want to sync potentially insecure data. With encryption, it is now possible
-- to sync environments securely. However, there were already sync states in the
-- DB that marked environments as "Synced". Running the sync code on these envs
-- would mark them as deleted by FS (exist in SyncState but not on FS).
--
-- To undo this mess, we have this migration to delete all environment-related
-- sync states so we can sync from a clean slate.
DELETE
FROM sync_states
WHERE model_id LIKE 'ev_%';
