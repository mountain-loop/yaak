import type { Settings } from "@yaakapp-internal/models";
import { useKeyValue } from "../../hooks/useKeyValue";
import { CopyIconButton } from "../CopyIconButton";
import {
  ModelSettingRowBoolean,
  SettingRow,
  SettingValue,
  SettingsSection,
} from "../core/SettingRow";

const MCP_URL = "http://127.0.0.1:64343/mcp";

export function SettingsMcpServer({ settings }: { settings: Settings }) {
  const { value: token } = useKeyValue<string | null>({
    namespace: "no_sync",
    key: "mcp_server_token",
    fallback: null,
  });

  const config = token == null ? null : clientConfig(token);

  return (
    <SettingsSection title="MCP Server">
      <ModelSettingRowBoolean
        model={settings}
        modelKey="mcpServerEnabled"
        title="Enable MCP server"
        description={
          <>
            Let AI agents like Claude Code read, edit, and send your requests at{" "}
            <code className="font-mono">{MCP_URL}</code> while Yaak is open. To use the same tools
            without the app, run <code className="font-mono">yaak mcp</code> from the Yaak CLI.
          </>
        }
      />
      {settings.mcpServerEnabled && token != null && config != null && (
        <>
          <SettingRow
            title="Token"
            description="Clients send this as a bearer token."
            controlClassName="min-w-0 max-w-[min(24rem,40vw)] gap-2"
          >
            <SettingValue value={token} />
          </SettingRow>
          <div className="py-4">
            <div className="text text-text">Client config</div>
            <div className="mt-1 text-sm text-text-subtle">
              For clients that read an <code className="font-mono">mcpServers</code> config, like
              Claude Desktop and Cursor.
            </div>
            <div className="mt-3 relative rounded-md border border-border-subtle bg-surface-highlight">
              <pre className="p-3 pr-10 font-mono text-editor text-text-subtle select-text whitespace-pre-wrap wrap-break-word">
                {config}
              </pre>
              <CopyIconButton
                className="absolute top-1.5 right-1.5"
                size="xs"
                text={config}
                title="Copy config"
              />
            </div>
          </div>
        </>
      )}
    </SettingsSection>
  );
}

function clientConfig(token: string) {
  const args = ["-y", "mcp-remote", MCP_URL, "--header", `Authorization: Bearer ${token}`];
  return [
    "{",
    '  "mcpServers": {',
    '    "yaak": {',
    '      "command": "npx",',
    `      "args": [${args.map((a) => JSON.stringify(a)).join(", ")}]`,
    "    }",
    "  }",
    "}",
  ].join("\n");
}
