DROP TABLE http_exchanges;

CREATE TABLE flows
(
    id                    TEXT     NOT NULL PRIMARY KEY,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    started_at            DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    method                TEXT     NOT NULL DEFAULT '',
    url                   TEXT     NOT NULL DEFAULT '',
    client_http_version   TEXT     NOT NULL DEFAULT '',
    upstream_http_version TEXT,
    remote_addr           TEXT,
    status                INTEGER,
    content_type          TEXT,
    request_headers       TEXT     NOT NULL DEFAULT '[]',
    response_headers      TEXT     NOT NULL DEFAULT '[]',
    request_size          INTEGER  NOT NULL DEFAULT 0,
    response_size         INTEGER  NOT NULL DEFAULT 0,
    request_truncated     BOOLEAN  NOT NULL DEFAULT FALSE,
    response_truncated    BOOLEAN  NOT NULL DEFAULT FALSE,
    elapsed_headers_ms    INTEGER,
    elapsed_ms            INTEGER,
    error                 TEXT
);

CREATE INDEX idx_flows_started_at ON flows (started_at);
