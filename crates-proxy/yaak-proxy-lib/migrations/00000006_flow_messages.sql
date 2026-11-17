-- Streaming flows: WebSocket, server-sent events, gRPC and gRPC-Web.
ALTER TABLE flows ADD COLUMN stream_kind TEXT;
ALTER TABLE flows ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
-- A gRPC call's service and method, from its path, and its status, from its trailers.
ALTER TABLE flows ADD COLUMN grpc_service TEXT;
ALTER TABLE flows ADD COLUMN grpc_method TEXT;
ALTER TABLE flows ADD COLUMN grpc_status INTEGER;
ALTER TABLE flows ADD COLUMN grpc_message TEXT;

-- The messages of streaming flows, in the order they passed. A payload over a few KB is in
-- blobs.sqlite, under `<flow id>.msg.<message id>`, and `data` is NULL.
CREATE TABLE flow_messages
(
    id          TEXT     NOT NULL PRIMARY KEY,
    flow_id     TEXT     NOT NULL,
    seq         INTEGER  NOT NULL,
    direction   TEXT     NOT NULL,
    kind        TEXT     NOT NULL,
    timestamp   DATETIME NOT NULL,
    size        INTEGER  NOT NULL DEFAULT 0,
    stored_size INTEGER  NOT NULL DEFAULT 0,
    truncated   BOOLEAN  NOT NULL DEFAULT FALSE,
    compressed  BOOLEAN  NOT NULL DEFAULT FALSE,
    error       TEXT,
    meta        TEXT     NOT NULL DEFAULT '{}',
    preview     TEXT,
    data        BLOB
);

CREATE UNIQUE INDEX idx_flow_messages_flow_id_seq ON flow_messages (flow_id, seq);

-- Where gRPC messages are decoded from: protos attached to a host pattern, or a server's
-- reflection, with the descriptors compiled from them.
CREATE TABLE grpc_schemas
(
    id           TEXT     NOT NULL PRIMARY KEY,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    host_pattern TEXT     NOT NULL,
    source       TEXT     NOT NULL,
    proto_paths  TEXT     NOT NULL DEFAULT '[]',
    services     TEXT     NOT NULL DEFAULT '[]',
    descriptor   BLOB     NOT NULL
);
