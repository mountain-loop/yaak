-- Add default User-Agent header to workspaces that don't already have one (case-insensitive check)
UPDATE workspaces
SET headers = json_insert(headers, '$[#]', json('{"enabled":true,"name":"User-Agent","value":"yaak"}'))
WHERE NOT EXISTS (
    SELECT 1 FROM json_each(workspaces.headers)
    WHERE LOWER(json_extract(value, '$.name')) = 'user-agent'
);

-- Add default Accept header to workspaces that don't already have one (case-insensitive check)
UPDATE workspaces
SET headers = json_insert(headers, '$[#]', json('{"enabled":true,"name":"Accept","value":"*/*"}'))
WHERE NOT EXISTS (
    SELECT 1 FROM json_each(workspaces.headers)
    WHERE LOWER(json_extract(value, '$.name')) = 'accept'
);
