-- Replace the per-resource snapshot with a content hash, and let a row exist without a model
-- so a resource the user chose not to import can be remembered.
CREATE TABLE import_source_resources_new
(
    model            TEXT     DEFAULT 'import_source_resource' NOT NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP        NOT NULL,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP        NOT NULL,
    import_source_id TEXT                                      NOT NULL,
    source_key       TEXT                                      NOT NULL,
    model_type       TEXT                                      NOT NULL,
    model_id         TEXT,
    content_hash     TEXT,
    PRIMARY KEY (import_source_id, source_key)
);

INSERT INTO import_source_resources_new (model, created_at, updated_at, import_source_id,
                                         source_key, model_type, model_id, content_hash)
SELECT model, created_at, updated_at, import_source_id, source_key, model_type, model_id, NULL
FROM import_source_resources;

DROP TABLE import_source_resources;

ALTER TABLE import_source_resources_new
    RENAME TO import_source_resources;
