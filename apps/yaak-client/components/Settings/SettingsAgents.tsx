import { useQuery } from "@tanstack/react-query";
import { settingsAtom } from "@yaakapp-internal/models";
import { platform } from "@yaakapp-internal/platform";
import { Heading, Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import type { AppMetaData } from "@yaakapp-internal/rpc-schema";
import { useAtomValue } from "jotai";
import { useKeyValue } from "../../hooks/useKeyValue";
import { appInfo } from "../../lib/appInfo";
import {
  AGENT_CLIENTS,
  type AgentClient,
  type AgentSetup,
  appSetup,
  cliSetup,
} from "../../lib/agentSetup";
import { rpc } from "../../lib/rpc";
import { CopyIconButton } from "../CopyIconButton";
import { Button } from "../core/Button";
import { Editor } from "../core/Editor/LazyEditor";
import { IconButton } from "../core/IconButton";
import { SegmentedControl } from "../core/SegmentedControl";
import {
  ModelSettingRowBoolean,
  SettingRow,
  SettingValue,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

const MCP_URL = "http://127.0.0.1:64343/mcp";
const CLI_INSTALL_COMMAND = "npm install -g @yaakapp/cli";
const SKILL_INSTALL_COMMAND = "yaak agent install";

export function SettingsAgents() {
  const settings = useAtomValue(settingsAtom);
  const { value: token } = useKeyValue<string | null>({
    namespace: "no_sync",
    key: "mcp_server_token",
    fallback: null,
  });
  const { value: storedClient, set: setClient } = useKeyValue<AgentClient>({
    key: "agents_setup_client",
    fallback: "claude_code",
  });
  const client = AGENT_CLIENTS.find((c) => c.value === storedClient)?.value ?? "claude_code";
  const cliVersion = useQuery({
    queryKey: ["cli_version"],
    queryFn: async () => (await rpc<AppMetaData>("cmd_metadata")).cliVersion,
    initialData: appInfo.cliVersion,
  });

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-3">
        <Heading>Agents</Heading>
        <p className="text-text-subtle">
          Connect AI coding agents like Claude Code and Cursor to Yaak, so they can read, edit, and
          send your requests.
        </p>
      </div>
      <SettingsList className="space-y-8">
        <SettingsSection
          title="Yaak CLI"
          description="Lets agents use Yaak from the command line, even with the app closed."
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
            <SettingRow
              title="Agent skill"
              description={
                <>
                  Teach Claude Code, Cursor, Codex, and opencode to drive the{" "}
                  <InlineCode>yaak</InlineCode> command, wherever they're installed.
                </>
              }
            >
              <SettingValue value={SKILL_INSTALL_COMMAND} />
            </SettingRow>
          )}
        </SettingsSection>

        <SettingsSection
          title="MCP server in the app"
          description="For agents that connect over HTTP, or to act on the workspaces open in Yaak."
        >
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
            <SettingRow
              title="Token"
              description="Agents send this as a bearer token."
              controlClassName="min-w-0 max-w-[min(24rem,40vw)] gap-2"
            >
              <SettingValue value={token} />
            </SettingRow>
          )}
        </SettingsSection>

        <SettingsSection
          title="Connect an agent"
          description="Pick your agent or editor to see how to add Yaak's MCP tools to it."
        >
          <div className="py-4 border-b border-border-subtle">
            <SegmentedControl
              name="agents_setup_client"
              label="Agent"
              hideLabel
              value={client}
              onChange={setClient}
              options={AGENT_CLIENTS}
            />
          </div>
          <SetupRow
            title="Through the Yaak CLI"
            description={
              cliVersion.data == null
                ? "Recommended. Install the Yaak CLI above first."
                : `Recommended. ${cliSetup(client).where}`
            }
            setup={cliSetup(client)}
          />
          {settings.mcpServerEnabled && token != null ? (
            <SetupRow
              title="Through the app"
              description={appSetup(client, MCP_URL, token).where}
              setup={appSetup(client, MCP_URL, token)}
            />
          ) : (
            <SettingRow
              title="Through the app"
              description="Turn on the MCP server above to connect this way."
            >
              <span />
            </SettingRow>
          )}
        </SettingsSection>
      </SettingsList>
    </VStack>
  );
}

function SetupRow({
  title,
  description,
  setup,
}: {
  title: string;
  description: string;
  setup: AgentSetup;
}) {
  return (
    <div className="py-4 border-b border-border-subtle">
      <div className="text text-text">{title}</div>
      <div className="mt-1 text-sm text-text-subtle">{description}</div>
      <Editor
        readOnly
        hideGutter
        wrapLines
        heightMode="auto"
        stateKey={null}
        language={setup.language}
        defaultValue={setup.snippet}
        className="mt-3 border border-border-subtle rounded-md px-2"
        actions={<CopyIconButton size="sm" variant="border" text={setup.snippet} title="Copy setup" />}
      />
    </div>
  );
}
