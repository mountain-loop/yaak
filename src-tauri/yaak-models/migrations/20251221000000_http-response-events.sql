CREATE TABLE http_response_events
(
    id           TEXT                                                    NOT NULL
        PRIMARY KEY,
    model        TEXT     DEFAULT 'http_response_event'                  NOT NULL,
    workspace_id TEXT                                                    NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    response_id  TEXT                                                    NOT NULL
        REFERENCES http_responses
            ON DELETE CASCADE,
    created_at   DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    updated_at   DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,
    event        TEXT                                                    NOT NULL
);
