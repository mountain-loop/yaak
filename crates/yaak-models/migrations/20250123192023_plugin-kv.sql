CREATE TABLE plugin_key_values
(
    model       TEXT     DEFAULT 'plugin_key_value' NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP  NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP  NOT NULL,
    deleted_at  DATETIME,
    plugin_name TEXT                                NOT NULL,
    key         TEXT                                NOT NULL,
    value       TEXT                                NOT NULL,
    PRIMARY KEY (plugin_name, key)
);
