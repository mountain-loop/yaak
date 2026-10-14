ALTER TABLE http_requests ADD COLUMN assertions TEXT NOT NULL DEFAULT '{"version":1,"checks":[]}';
ALTER TABLE http_responses ADD COLUMN assertion_results TEXT;
