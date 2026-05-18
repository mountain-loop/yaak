ALTER TABLE websocket_requests ADD COLUMN setting_validate_certificates TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;

ALTER TABLE grpc_requests ADD COLUMN setting_validate_certificates TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
