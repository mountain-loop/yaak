-- Filter out headers that match the hardcoded defaults (User-Agent: yaak, Accept: */*),
-- keeping any other custom headers the user may have added.
UPDATE workspaces
SET headers = (
    SELECT json_group_array(json(value))
    FROM json_each(headers)
    WHERE NOT (
        (LOWER(json_extract(value, '$.name')) = 'user-agent' AND json_extract(value, '$.value') = 'yaak')
        OR (LOWER(json_extract(value, '$.name')) = 'accept' AND json_extract(value, '$.value') = '*/*')
    )
)
WHERE json_array_length(headers) > 0;
