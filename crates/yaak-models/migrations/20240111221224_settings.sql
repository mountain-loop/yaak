CREATE TABLE settings
(
    id                    TEXT                               NOT NULL
        PRIMARY KEY,
    model                 TEXT     DEFAULT 'settings'        NOT NULL,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    follow_redirects      BOOLEAN  DEFAULT TRUE              NOT NULL,
    validate_certificates BOOLEAN  DEFAULT TRUE              NOT NULL,
    request_timeout       INTEGER  DEFAULT 0                 NOT NULL,
    theme                 TEXT     DEFAULT 'default'         NOT NULL,
    appearance            TEXT     DEFAULT 'system'          NOT NULL
);
