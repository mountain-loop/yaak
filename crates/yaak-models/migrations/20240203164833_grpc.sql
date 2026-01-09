CREATE TABLE grpc_requests
(
    id                  TEXT                                                    NOT NULL
        PRIMARY KEY,
    model               TEXT     DEFAULT 'grpc_request'                         NOT NULL,
    workspace_id        TEXT                                                    NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    folder_id           TEXT                                                    NULL
        REFERENCES folders
            ON DELETE CASCADE,
    created_at          DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    updated_at          DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    name                TEXT                                                    NOT NULL,
    sort_priority       REAL                                                    NOT NULL,
    url                 TEXT                                                    NOT NULL,
    service             TEXT                                                    NULL,
    method              TEXT                                                    NULL,
    message             TEXT                                                    NOT NULL,
    authentication      TEXT     DEFAULT '{}'                                   NOT NULL,
    authentication_type TEXT                                                    NULL,
    metadata            TEXT     DEFAULT '[]'                                   NOT NULL
);

CREATE TABLE grpc_connections
(
    id           TEXT                                                    NOT NULL
        PRIMARY KEY,
    model        TEXT     DEFAULT 'grpc_connection'                      NOT NULL,
    workspace_id TEXT                                                    NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    request_id   TEXT                                                    NOT NULL
        REFERENCES grpc_requests
            ON DELETE CASCADE,
    created_at   DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    updated_at   DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    url          TEXT                                                    NOT NULL,
    service      TEXT                                                    NOT NULL,
    method       TEXT                                                    NOT NULL,
    status       INTEGER  DEFAULT -1                                     NOT NULL,
    error        TEXT                                                    NULL,
    elapsed      INTEGER  DEFAULT 0                                      NOT NULL,
    trailers     TEXT     DEFAULT '{}'                                   NOT NULL
);

CREATE TABLE grpc_events
(
    id            TEXT                                                    NOT NULL
        PRIMARY KEY,
    model         TEXT     DEFAULT 'grpc_event'                           NOT NULL,
    workspace_id  TEXT                                                    NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    request_id    TEXT                                                    NOT NULL
        REFERENCES grpc_requests
            ON DELETE CASCADE,
    connection_id TEXT                                                    NOT NULL
        REFERENCES grpc_connections
            ON DELETE CASCADE,
    created_at    DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    updated_at    DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    metadata      TEXT     DEFAULT '{}'                                   NOT NULL,
    event_type    TEXT                                                    NOT NULL,
    status        INTEGER                                                 NULL,
    error         TEXT                                                    NULL,
    content       TEXT                                                    NOT NULL
);
