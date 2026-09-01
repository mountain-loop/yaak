CREATE TABLE import_sources
(
    id               TEXT                                NOT NULL PRIMARY KEY,
    model            TEXT     DEFAULT 'import_source'    NOT NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP  NOT NULL,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP  NOT NULL,
    workspace_id     TEXT                                NOT NULL,
    importer         TEXT                                NOT NULL,
    origin           TEXT                                NOT NULL,
    origin_label     TEXT                                NOT NULL,
    last_imported_at DATETIME DEFAULT CURRENT_TIMESTAMP  NOT NULL
);

CREATE TABLE import_source_resources
(
    model            TEXT     DEFAULT 'import_source_resource' NOT NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP        NOT NULL,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP        NOT NULL,
    import_source_id TEXT                                      NOT NULL,
    source_key       TEXT                                      NOT NULL,
    model_type       TEXT                                      NOT NULL,
    model_id         TEXT                                      NOT NULL,
    snapshot         TEXT                                      NOT NULL,
    PRIMARY KEY (import_source_id, source_key)
);
