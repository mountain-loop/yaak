-- Freeze the HTTP method, the originating request's name, and the request
-- body type on each response so history rows don't drift when the request is
-- later edited.
ALTER TABLE http_responses ADD COLUMN method TEXT;
ALTER TABLE http_responses ADD COLUMN request_name TEXT;
ALTER TABLE http_responses ADD COLUMN request_body_type TEXT;

-- Backfill method from the matching `send_url` event when we have one.
UPDATE http_responses
SET method = (
    SELECT json_extract(e.event, '$.method')
    FROM http_response_events e
    WHERE e.response_id = http_responses.id
      AND json_extract(e.event, '$.type') = 'send_url'
    ORDER BY e.created_at ASC
    LIMIT 1
);

-- Fall back to the current request method for older responses without events.
UPDATE http_responses
SET method = (
    SELECT method FROM http_requests WHERE id = http_responses.request_id
)
WHERE method IS NULL;

UPDATE http_responses
SET request_name = (
    SELECT name FROM http_requests WHERE id = http_responses.request_id
);

UPDATE http_responses
SET request_body_type = (
    SELECT body_type FROM http_requests WHERE id = http_responses.request_id
);
