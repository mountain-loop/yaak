ALTER TABLE workspaces ADD COLUMN setting_request_message_size INTEGER DEFAULT 67108864 NOT NULL;

ALTER TABLE folders ADD COLUMN setting_request_message_size TEXT DEFAULT '{"enabled":false,"value":67108864}' NOT NULL;

ALTER TABLE websocket_requests ADD COLUMN setting_request_message_size TEXT DEFAULT '{"enabled":false,"value":67108864}' NOT NULL;

ALTER TABLE grpc_requests ADD COLUMN setting_request_message_size TEXT DEFAULT '{"enabled":false,"value":67108864}' NOT NULL;
