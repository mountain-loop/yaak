-- Remove default headers from workspaces that have exactly the unmodified defaults
-- (User-Agent: yaak and Accept: */*), since these are now injected at request time.
UPDATE workspaces
SET headers = '[]'
WHERE json_array_length(headers) = 2
  AND (
    SELECT COUNT(*) FROM json_each(headers)
    WHERE (
      LOWER(json_extract(value, '$.name')) = 'user-agent'
      AND json_extract(value, '$.value') = 'yaak'
      AND json_extract(value, '$.enabled') = 1
    ) OR (
      LOWER(json_extract(value, '$.name')) = 'accept'
      AND json_extract(value, '$.value') = '*/*'
      AND json_extract(value, '$.enabled') = 1
    )
  ) = 2;
