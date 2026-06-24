CREATE TABLE http_exchanges
(
    id          TEXT    NOT NULL PRIMARY KEY,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    url         TEXT    NOT NULL DEFAULT '',
    method      TEXT    NOT NULL DEFAULT '',
    req_headers TEXT    NOT NULL DEFAULT '[]',
    req_body    BLOB,
    res_status  INTEGER,
    res_headers TEXT    NOT NULL DEFAULT '[]',
    res_body    BLOB,
    error       TEXT
);
