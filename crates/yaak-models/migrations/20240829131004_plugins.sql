CREATE TABLE plugins
(
    id         TEXT                               NOT NULL
        PRIMARY KEY,
    model      TEXT     DEFAULT 'plugin'          NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checked_at DATETIME NULL,
    enabled    BOOLEAN                            NOT NULL,
    directory  TEXT NULL                          NOT NULL,
    url        TEXT NULL
);
