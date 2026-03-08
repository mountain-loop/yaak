-- Proxy version of http_responses, duplicated from client.
-- No workspace_id/request_id foreign keys — proxy captures raw traffic.
CREATE TABLE proxy_http_responses (
    id                        TEXT    NOT NULL PRIMARY KEY,
    model                     TEXT    DEFAULT 'proxy_http_response' NOT NULL,
    proxy_request_id          INTEGER NOT NULL,
    created_at                DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    elapsed                   INTEGER NOT NULL DEFAULT 0,
    elapsed_headers           INTEGER NOT NULL DEFAULT 0,
    elapsed_dns               INTEGER NOT NULL DEFAULT 0,
    status                    INTEGER NOT NULL DEFAULT 0,
    status_reason             TEXT,
    url                       TEXT    NOT NULL,
    headers                   TEXT    NOT NULL DEFAULT '[]',
    request_headers           TEXT    NOT NULL DEFAULT '[]',
    error                     TEXT,
    body_path                 TEXT,
    content_length            INTEGER,
    content_length_compressed INTEGER,
    request_content_length    INTEGER,
    remote_addr               TEXT,
    version                   TEXT,
    state                     TEXT    DEFAULT 'initialized' NOT NULL
);
CREATE INDEX idx_proxy_http_responses_created_at ON proxy_http_responses (created_at DESC);

-- Inline body storage (proxy keeps everything self-contained in one DB file)
CREATE TABLE proxy_http_response_bodies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    response_id TEXT NOT NULL REFERENCES proxy_http_responses(id) ON DELETE CASCADE,
    body_type   TEXT NOT NULL,
    data        BLOB NOT NULL,
    UNIQUE(response_id, body_type)
);
