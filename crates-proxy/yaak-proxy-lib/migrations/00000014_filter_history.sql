-- Filters applied from the search box, each once, most recently applied first.
CREATE TABLE filter_history
(
    filter     TEXT     NOT NULL PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);
