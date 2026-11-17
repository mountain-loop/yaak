-- Filters applied from the search box, each once, most recently applied first.
CREATE TABLE filter_history
(
    filter     TEXT     NOT NULL PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- The filter the window last applied, however it was applied, which the next launch restores.
CREATE TABLE last_filter
(
    id     INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
    filter TEXT    NOT NULL
);
