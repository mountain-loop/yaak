-- An agent read the flow through the control API: its detail, a body or its messages.
ALTER TABLE flows ADD COLUMN agent_read BOOLEAN NOT NULL DEFAULT FALSE;

-- Searches saved by name, listed in the sidebar by `sort_order`.
CREATE TABLE saved_queries
(
    id         TEXT     NOT NULL PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    name       TEXT     NOT NULL,
    query      TEXT     NOT NULL,
    sort_order INTEGER  NOT NULL DEFAULT 0
);
