-- Add a setting to run the built-in MCP server
ALTER TABLE settings
    ADD COLUMN mcp_server_enabled BOOLEAN DEFAULT FALSE NOT NULL;
