export type AgentClient = "claude_code" | "codex" | "cursor" | "vscode" | "other";

export const AGENT_CLIENTS: { label: string; value: AgentClient }[] = [
  { label: "Claude Code", value: "claude_code" },
  { label: "Codex", value: "codex" },
  { label: "Cursor", value: "cursor" },
  { label: "VS Code", value: "vscode" },
  { label: "Other", value: "other" },
];

export interface AgentSetup {
  /** Where the snippet goes, as a sentence */
  where: string;
  snippet: string;
  language: "shell" | "json" | "text";
}

const RUN_IN_TERMINAL = "Run in a terminal.";

/** Setup for `yaak mcp`, which the client launches over stdio. */
export function cliSetup(client: AgentClient): AgentSetup {
  switch (client) {
    case "claude_code":
      return { where: RUN_IN_TERMINAL, snippet: "claude mcp add yaak -- yaak mcp", language: "shell" };
    case "codex":
      return { where: RUN_IN_TERMINAL, snippet: "codex mcp add yaak -- yaak mcp", language: "shell" };
    case "cursor":
      return {
        where: "Add to ~/.cursor/mcp.json.",
        snippet: json({ mcpServers: { yaak: { command: "yaak", args: ["mcp"] } } }),
        language: "json",
      };
    case "vscode":
      return {
        where: "Add to your user mcp.json (MCP: Open User Configuration).",
        snippet: json({ servers: { yaak: { type: "stdio", command: "yaak", args: ["mcp"] } } }),
        language: "json",
      };
    case "other":
      return {
        where: "For clients that read an mcpServers config, like Claude Desktop and Windsurf.",
        snippet: json({ mcpServers: { yaak: { command: "yaak", args: ["mcp"] } } }),
        language: "json",
      };
  }
}

/** Setup for the app's MCP server at `url`, which needs `token` as a bearer token. */
export function appSetup(client: AgentClient, url: string, token: string): AgentSetup {
  const authorization = `Bearer ${token}`;
  switch (client) {
    case "claude_code":
      return {
        where: RUN_IN_TERMINAL,
        snippet: `claude mcp add --transport http yaak ${url} --header "Authorization: ${authorization}"`,
        language: "shell",
      };
    case "codex":
      return {
        where: "Add to ~/.codex/config.toml.",
        snippet: [
          "[mcp_servers.yaak]",
          `url = ${JSON.stringify(url)}`,
          `http_headers = { "Authorization" = ${JSON.stringify(authorization)} }`,
        ].join("\n"),
        language: "text",
      };
    case "cursor":
      return {
        where: "Add to ~/.cursor/mcp.json.",
        snippet: json({ mcpServers: { yaak: { url, headers: { Authorization: authorization } } } }),
        language: "json",
      };
    case "vscode":
      return {
        where: "Add to your user mcp.json (MCP: Open User Configuration).",
        snippet: json({
          servers: { yaak: { type: "http", url, headers: { Authorization: authorization } } },
        }),
        language: "json",
      };
    case "other":
      return {
        where: "For clients that read an mcpServers config, through the mcp-remote bridge.",
        snippet: json({
          mcpServers: {
            yaak: {
              command: "npx",
              args: ["-y", "mcp-remote", url, "--header", `Authorization: ${authorization}`],
            },
          },
        }),
        language: "json",
      };
  }
}

/** Pretty JSON with arrays of plain values kept on one line. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /\[\n\s*([^[\]{}]*?)\n\s*\]/g,
    (_, items: string) => `[${items.split(/,\n\s*/).join(", ")}]`,
  );
}
