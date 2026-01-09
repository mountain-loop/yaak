-- Clean up old key/values that are no longer used
DELETE
FROM key_values
WHERE key LIKE 'graphql_introspection::%';

CREATE TABLE graphql_introspections
(

    id           TEXT                                     NOT NULL
        PRIMARY KEY,
    model        TEXT     DEFAULT 'graphql_introspection' NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP       NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP       NOT NULL,
    workspace_id TEXT                                     NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    request_id   TEXT                                     NULL
        REFERENCES http_requests
            ON DELETE CASCADE,
    content      TEXT                                     NULL
);
