ALTER TABLE workspace_metas
    ADD COLUMN openapi_import_url TEXT;

ALTER TABLE workspace_metas
    ADD COLUMN openapi_last_synced_at DATETIME;
