CREATE TABLE key_values
(
    model      TEXT     DEFAULT 'key_value'       NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at DATETIME,
    namespace  TEXT                               NOT NULL,
    key        TEXT                               NOT NULL,
    value      TEXT                               NOT NULL,
    PRIMARY KEY (namespace, key)
);

CREATE TABLE workspaces
(
    id          TEXT                               NOT NULL
        PRIMARY KEY,
    model       TEXT     DEFAULT 'workspace'       NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at  DATETIME,
    name        TEXT                               NOT NULL,
    description TEXT                               NOT NULL
);

CREATE TABLE http_requests
(
    id           TEXT                               NOT NULL
        PRIMARY KEY,
    model        TEXT     DEFAULT 'http_request'    NOT NULL,
    workspace_id TEXT                               NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at   DATETIME,
    name         TEXT                               NOT NULL,
    url          TEXT                               NOT NULL,
    method       TEXT                               NOT NULL,
    headers      TEXT                               NOT NULL,
    body         TEXT,
    body_type    TEXT
);

CREATE TABLE http_responses
(
    id            TEXT                               NOT NULL
        PRIMARY KEY,
    model         TEXT     DEFAULT 'http_response'   NOT NULL,
    request_id    TEXT                               NOT NULL
        REFERENCES http_requests
            ON DELETE CASCADE,
    workspace_id  TEXT                               NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at    DATETIME,
    elapsed       INTEGER                            NOT NULL,
    status        INTEGER                            NOT NULL,
    status_reason TEXT,
    url           TEXT                               NOT NULL,
    body          TEXT                               NOT NULL,
    headers       TEXT                               NOT NULL,
    error         TEXT
);
