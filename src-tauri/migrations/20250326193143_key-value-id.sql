-- 1. Create the new table with `id` as the primary key
CREATE TABLE key_values_new
(
    id         TEXT PRIMARY KEY,
    model      TEXT     DEFAULT 'key_value'       NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at DATETIME,
    namespace  TEXT                               NOT NULL,
    key        TEXT                               NOT NULL,
    value      TEXT                               NOT NULL
);

-- 2. Copy data from the old table
INSERT INTO key_values_new (id, model, created_at, updated_at, deleted_at, namespace, key, value)
SELECT (
           -- This is the best way to generate a random string in SQLite, apparently
           'kv_' || SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1)
           ) AS id,
       model,
       created_at,
       updated_at,
       deleted_at,
       namespace,
       key,
       value
FROM key_values;

-- 3. Drop the old table
DROP TABLE key_values;

-- 4. Rename the new table
ALTER TABLE key_values_new
    RENAME TO key_values;
