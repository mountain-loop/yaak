CREATE TABLE body_chunks
(
    id          TEXT PRIMARY KEY,
    body_id     TEXT    NOT NULL,
    chunk_index INTEGER NOT NULL,
    data        BLOB    NOT NULL,
    created_at  DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL,

    UNIQUE (body_id, chunk_index)
);

CREATE INDEX idx_body_chunks_body_id ON body_chunks (body_id, chunk_index);
