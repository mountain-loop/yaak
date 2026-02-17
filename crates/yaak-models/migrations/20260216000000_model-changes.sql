CREATE TABLE model_changes
(
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    model         TEXT                                                    NOT NULL,
    model_id      TEXT                                                    NOT NULL,
    change        TEXT                                                    NOT NULL,
    update_source TEXT                                                    NOT NULL,
    payload       TEXT                                                    NOT NULL,
    created_at    DATETIME DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')) NOT NULL
);

CREATE INDEX idx_model_changes_created_at ON model_changes (created_at);
