CREATE TABLE cookie_jars
(
    id           TEXT                               NOT NULL PRIMARY KEY,
    model        TEXT     DEFAULT 'cookie_jar'      NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    name         TEXT                               NOT NULL,
    cookies      TEXT     DEFAULT '[]'              NOT NULL,
    workspace_id TEXT                               NOT NULL
);
