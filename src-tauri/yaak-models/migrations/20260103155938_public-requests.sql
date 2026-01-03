-- Add a public column to requests to control whether they are synced/exported
-- Defaults to TRUE (public) so existing requests continue to sync as before

ALTER TABLE http_requests
    ADD COLUMN public BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE grpc_requests
    ADD COLUMN public BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE websocket_requests
    ADD COLUMN public BOOLEAN NOT NULL DEFAULT TRUE;
