ALTER TABLE http_responses
    ADD COLUMN environment_id TEXT DEFAULT '__LEGACY__' NULL;

ALTER TABLE grpc_connections
    ADD COLUMN environment_id TEXT DEFAULT '__LEGACY__' NULL;

ALTER TABLE websocket_connections
    ADD COLUMN environment_id TEXT DEFAULT '__LEGACY__' NULL;
