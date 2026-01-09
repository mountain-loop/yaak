ALTER TABLE http_responses
    ADD COLUMN state TEXT DEFAULT 'closed' NOT NULL;

ALTER TABLE grpc_connections
    ADD COLUMN state TEXT DEFAULT 'closed' NOT NULL;
