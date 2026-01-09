CREATE TABLE websocket_requests
(
    id                  TEXT                                 NOT NULL
        PRIMARY KEY,
    model               TEXT     DEFAULT 'websocket_request' NOT NULL,
    workspace_id        TEXT                                 NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    folder_id           TEXT
        REFERENCES folders
            ON DELETE CASCADE,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP   NOT NULL,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP   NOT NULL,
    deleted_at          DATETIME,
    authentication      TEXT     DEFAULT '{}'                NOT NULL,
    authentication_type TEXT,
    description         TEXT                                 NOT NULL,
    name                TEXT                                 NOT NULL,
    url                 TEXT                                 NOT NULL,
    headers             TEXT                                 NOT NULL,
    message             TEXT                                 NOT NULL,
    sort_priority       REAL                                 NOT NULL,
    url_parameters      TEXT     DEFAULT '[]'                NOT NULL
);

CREATE TABLE websocket_connections
(
    id           TEXT                                    NOT NULL
        PRIMARY KEY,
    model        TEXT     DEFAULT 'websocket_connection' NOT NULL,
    workspace_id TEXT                                    NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    request_id   TEXT                                    NOT NULL
        REFERENCES websocket_requests
            ON DELETE CASCADE,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP      NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP      NOT NULL,
    url          TEXT                                    NOT NULL,
    state        TEXT                                    NOT NULL,
    status       INTEGER  DEFAULT -1                     NOT NULL,
    error        TEXT                                    NULL,
    elapsed      INTEGER  DEFAULT 0                      NOT NULL,
    headers      TEXT     DEFAULT '{}'                   NOT NULL
);

CREATE TABLE websocket_events
(
    id            TEXT                                                    NOT NULL
        PRIMARY KEY,
    model         TEXT     DEFAULT 'websocket_event'                      NOT NULL,
    workspace_id  TEXT                                                    NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    request_id    TEXT                                                    NOT NULL
        REFERENCES websocket_requests
            ON DELETE CASCADE,
    connection_id TEXT                                                    NOT NULL
        REFERENCES websocket_connections
            ON DELETE CASCADE,
    created_at    DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    updated_at    DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    is_server     BOOLEAN                                                 NOT NULL,
    message_type  TEXT                                                    NOT NULL,
    message       BLOB                                                    NOT NULL
);
