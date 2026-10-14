import { useQuery } from "@tanstack/react-query";
import { settingsAtom } from "@yaakapp-internal/models";
import { platform } from "@yaakapp-internal/platform";
import { Heading, Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import type { AppMetaData } from "@yaakapp-internal/rpc-schema";
import { useAtomValue } from "jotai";
import { useKeyValue } from "../../hooks/useKeyValue";
import { appInfo } from "../../lib/appInfo";
import { rpc } from "../../lib/rpc";
import { CopyIconButton } from "../CopyIconButton";
import { Button } from "../core/Button";
import { IconButton } from "../core/IconButton";
import {
  ModelSettingRowBoolean,
  SettingRow,
  SettingValue,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

const MCP_URL = "http://127.0.0.1:64343/mcp";
const CLI_INSTALL_COMMAND = "npm install -g @yaakapp/cli";
const CLAUDE_CODE_COMMAND = "claude mcp add yaak -- yaak mcp";

export function SettingsMcp() {
  const settings = useAtomValue(settingsAtom);
  const { value: token } = useKeyValue<string | null>({
    namespace: "no_sync",
    key: "mcp_server_token",
    fallback: null,
  });
  const cliVersion = useQuery({
    queryKey: ["cli_version"],
    queryFn: async () => (await rpc<AppMetaData>("cmd_metadata")).cliVersion,
    initialData: appInfo.cliVersion,
  });

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-3">
        <Heading>MCP</Heading>
        <p className="text-text-subtle">
          Let AI agents like Claude Code and Cursor read, edit, and send your requests over the
          Model Context Protocol.
        </p>
      </div>
      <SettingsList className="space-y-8">
        <SettingsSection title="Yaak app">
          <ModelSettingRowBoolean
            model={settings}
            modelKey="mcpServerEnabled"
            title="Enable MCP server"
            description={
              <>
                Serve Yaak's tools at <InlineCode>{MCP_URL}</InlineCode> while Yaak is open.
              </>
            }
          />
          {settings.mcpServerEnabled && token != null && (
            <>
              <SettingRow
                title="Token"
                description="Clients send this as a bearer token."
                controlClassName="min-w-0 max-w-[min(24rem,40vw)] gap-2"
              >
                <SettingValue value={token} />
              </SettingRow>
              <SnippetRow
                title="Client config"
                description={
                  <>
                    For clients that read an <InlineCode>mcpServers</InlineCode> config, like Claude
                    Desktop and Cursor.
                  </>
                }
                snippet={mcpServersConfig("npx", [
                  "-y",
                  "mcp-remote",
                  MCP_URL,
                  "--header",
                  `Authorization: Bearer ${token}`,
                ])}
              />
            </>
          )}
        </SettingsSection>

        <SettingsSection
          title="Yaak CLI"
          description={
            <>
              Serve the same tools over stdio with <InlineCode>yaak mcp</InlineCode>, without the
              app open.
            </>
          }
        >
          <SettingRow
            title="Status"
            description={
              cliVersion.data == null
                ? "The Yaak CLI is not installed."
                : `Yaak CLI ${cliVersion.data} is installed.`
            }
            controlClassName="gap-2"
          >
            <IconButton
              size="sm"
              icon="refresh"
              title="Check again"
              spin={cliVersion.isFetching}
              onClick={() => cliVersion.refetch()}
            />
            {cliVersion.data == null && (
              <Button
                variant="border"
                color="secondary"
                size="sm"
                onClick={() => platform.openUrl("https://yaak.app/docs/cli")}
                rightSlot={<Icon icon="external_link" />}
              >
                Install CLI
              </Button>
            )}
          </SettingRow>
          {cliVersion.data == null ? (
            <SettingRow title="Install" description="Install it with npm.">
              <SettingValue value={CLI_INSTALL_COMMAND} />
            </SettingRow>
          ) : (
            <>
              <SettingRow title="Claude Code" description="Add Yaak to Claude Code.">
                <SettingValue value={CLAUDE_CODE_COMMAND} />
              </SettingRow>
              <SnippetRow
                title="Client config"
                description={
                  <>
                    For clients that read an <InlineCode>mcpServers</InlineCode> config.
                  </>
                }
                snippet={mcpServersConfig("yaak", ["mcp"])}
              />
            </>
          )}
        </SettingsSection>
      </SettingsList>
    </VStack>
  );
}

function SnippetRow({
  title,
  description,
  snippet,
}: {
  title: string;
  description: React.ReactNode;
  snippet: string;
}) {
  return (
    <div className="py-4 border-b border-border-subtle">
      <div className="text text-text">{title}</div>
      <div className="mt-1 text-sm text-text-subtle">{description}</div>
      <div className="mt-3 relative rounded-md border border-border-subtle bg-surface-highlight">
        <pre className="p-3 pr-10 font-mono text-editor text-text-subtle select-text whitespace-pre-wrap wrap-break-word">
          {snippet}
        </pre>
        <div className="absolute top-1.5 right-1.5">
          <CopyIconButton size="xs" text={snippet} title={`Copy ${title.toLowerCase()}`} />
        </div>
      </div>
    </div>
  );
}

function mcpServersConfig(command: string, args: string[]) {
  return [
    "{",
    '  "mcpServers": {',
    '    "yaak": {',
    `      "command": ${JSON.stringify(command)},`,
    `      "args": [${args.map((a) => JSON.stringify(a)).join(", ")}]`,
    "    }",
    "  }",
    "}",
  ].join("\n");
}
