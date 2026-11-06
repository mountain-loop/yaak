import { useQuery, useQueryClient } from "@tanstack/react-query";
import { platform } from "@yaakapp-internal/platform";
import type { AgentSetupStatus, AppMetaData } from "@yaakapp-internal/rpc-schema";
import { Banner, Heading, Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import { useEffect } from "react";
import { useKeyValue } from "../../hooks/useKeyValue";
import { usePluginInfos } from "../../hooks/usePluginInfo";
import {
  AGENT_CLIENTS,
  type AgentClient,
  cliSetup,
  skillInstallCommand,
} from "../../lib/agentSetup";
import { appInfo } from "../../lib/appInfo";
import { rpc } from "../../lib/rpc";
import { Link } from "../core/Link";
import { SegmentedControl } from "../core/SegmentedControl";
import {
  SettingCommand,
  SettingSnippet,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";
import { DeprecatedPluginBanner } from "./SettingsPlugins";

const CLI_INSTALL_COMMAND = "npm install -g @yaakapp/cli";
const MCP_SERVER_PLUGIN = "@yaak/mcp-server";

export function SettingsAgents() {
  const queryClient = useQueryClient();
  const { value: storedClient, set: setClient } = useKeyValue<AgentClient>({
    key: "agents_setup_client",
    fallback: "claude_code",
  });
  const client = AGENT_CLIENTS.find((c) => c.value === storedClient)?.value ?? "claude_code";
  const clientLabel = AGENT_CLIENTS.find((c) => c.value === client)?.label ?? "your agent";
  const cliVersion = useQuery({
    queryKey: ["cli_version"],
    queryFn: async () => (await rpc<AppMetaData>("cmd_metadata")).cliVersion,
    initialData: appInfo.cliVersion,
  });
  const setupStatus = useQuery({
    queryKey: ["agent_setup_status", client],
    queryFn: () => rpc<AgentSetupStatus>("cmd_agent_setup_status", { agent: client }),
  });
  const mcpServerPlugin = usePluginInfos().find(({ info }) => info.name === MCP_SERVER_PLUGIN);

  useEffect(() => {
    return platform.window.onFocusChanged((focused) => {
      if (!focused) return;
      void queryClient.invalidateQueries({ queryKey: ["cli_version"] });
      void queryClient.invalidateQueries({ queryKey: ["agent_setup_status"] });
    });
  }, [queryClient]);

  const cliInstalled = cliVersion.data != null;
  const cli = cliSetup(client);

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-3">
        <Heading>Agents</Heading>
        <p className="text-text-subtle">
          Connect AI coding agents like Claude Code and Cursor to Yaak.
        </p>
      </div>
      <SettingsList>
        <SettingsSection title={null}>
          <div className="pb-4 border-b border-border-subtle">
            <SegmentedControl
              name="agents_setup_client"
              label="Agent"
              hideLabel
              value={client}
              onChange={setClient}
              options={AGENT_CLIENTS}
            />
          </div>
          {cliInstalled ? (
            <div className="flex items-center gap-2 py-3 text-sm text-text-subtle border-b border-border-subtle">
              <Icon icon="check" size="sm" color="success" />
              <span>
                Yaak CLI <span className="text-text">{cliVersion.data}</span> is installed.
              </span>
            </div>
          ) : (
            <div className="py-4 border-b border-border-subtle">
              <Banner color="info">
                <div className="flex items-center gap-2 text text-text">
                  <Icon icon="square_terminal" color="info" />
                  Install the Yaak CLI first
                </div>
                <p className="mt-1 text-sm text-text-subtle">
                  Agents launch it to reach Yaak, even with the app closed.
                </p>
                <SettingSnippet className="mt-3" language="shell" snippet={CLI_INSTALL_COMMAND} />
                <div className="mt-3 mb-1 flex items-center gap-4 text-sm">
                  <Link href="https://yaak.app/docs/cli">Docs</Link>
                  <span className="text-text-subtlest">
                    Checks again when you come back to Yaak.
                  </span>
                </div>
              </Banner>
            </div>
          )}
          {mcpServerPlugin != null && (
            <div className="py-4 border-b border-border-subtle">
              <DeprecatedPluginBanner
                plugin={mcpServerPlugin.plugin}
                name={mcpServerPlugin.info.displayName}
              >
                The two steps below replace it. Uninstall it once your agent is connected.
              </DeprecatedPluginBanner>
            </div>
          )}
          <SettingCommand
            title="Add the MCP server"
            description={cli.where}
            snippet={cli.snippet}
            language={cli.language}
            disabled={!cliInstalled}
            done={setupStatus.data?.mcpServer ? "Added" : null}
          />
          <SettingCommand
            title="Install the skill"
            description={
              <>
                Lets {clientLabel} run the <InlineCode>yaak</InlineCode> command directly.
              </>
            }
            snippet={skillInstallCommand(client)}
            language="shell"
            disabled={!cliInstalled}
            done={setupStatus.data?.skill ? "Installed" : null}
          />
        </SettingsSection>
      </SettingsList>
    </VStack>
  );
}
