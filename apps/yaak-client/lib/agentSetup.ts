import type { AgentClient } from "@yaakapp-internal/rpc-schema";

export type { AgentClient };

export const AGENT_CLIENTS: { label: string; value: AgentClient }[] = [
  { label: "Claude Code", value: "claude_code" },
  { label: "Codex", value: "codex" },
  { label: "Cursor", value: "cursor" },
  { label: "VS Code", value: "vscode" },
  { label: "Other", value: "other" },
];

export interface AgentSetup {
  /** The file the snippet goes in, as a sentence, when it is a file rather than a command */
  where: string | null;
  snippet: string;
  language: "shell" | "json" | "text";
}

/** `yaak agent install`, targeted at `client` when the installer knows it by name. */
export function skillInstallCommand(client: AgentClient): string {
  switch (client) {
    case "claude_code":
      return "yaak agent install --agent claude-code";
    case "codex":
      return "yaak agent install --agent codex";
    case "cursor":
      return "yaak agent install --agent cursor";
    case "vscode":
    case "other":
      return "yaak agent install";
  }
}

/** Setup for `yaak mcp`, which the client launches over stdio. */
export function cliSetup(client: AgentClient): AgentSetup {
  switch (client) {
    case "claude_code":
      return { where: null, snippet: "claude mcp add -s user yaak -- yaak mcp", language: "shell" };
    case "codex":
      return { where: null, snippet: "codex mcp add yaak -- yaak mcp", language: "shell" };
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

/** Pretty JSON with arrays of plain values kept on one line. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /\[\n\s*([^[\]{}]*?)\n\s*\]/g,
    (_, items: string) => `[${items.split(/,\n\s*/).join(", ")}]`,
  );
}
