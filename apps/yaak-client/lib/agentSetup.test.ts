import { describe, expect, test } from "vite-plus/test";
import { AGENT_CLIENTS, cliSetup, skillInstallCommand } from "./agentSetup";

describe("cliSetup", () => {
  test("uses each client's own add command", () => {
    expect(cliSetup("claude_code").snippet).toBe("claude mcp add -s user yaak -- yaak mcp");
    expect(cliSetup("codex").snippet).toBe("codex mcp add yaak -- yaak mcp");
  });

  test("names a file only when the snippet goes in one", () => {
    expect(cliSetup("claude_code").where).toBeNull();
    expect(cliSetup("codex").where).toBeNull();
    expect(cliSetup("cursor").where).toBe("Add to ~/.cursor/mcp.json.");
    expect(cliSetup("vscode").where).toContain("mcp.json");
    expect(cliSetup("other").where).not.toBeNull();
  });

  test("writes the config shape each client reads", () => {
    expect(JSON.parse(cliSetup("cursor").snippet)).toEqual({
      mcpServers: { yaak: { command: "yaak", args: ["mcp"] } },
    });
    expect(JSON.parse(cliSetup("vscode").snippet)).toEqual({
      servers: { yaak: { type: "stdio", command: "yaak", args: ["mcp"] } },
    });
    expect(JSON.parse(cliSetup("other").snippet)).toEqual({
      mcpServers: { yaak: { command: "yaak", args: ["mcp"] } },
    });
  });

  test("keeps argument lists on one line", () => {
    expect(cliSetup("cursor").snippet).toContain(`"args": ["mcp"]`);
  });

  test("covers every listed client", () => {
    for (const { value } of AGENT_CLIENTS) {
      expect(cliSetup(value).snippet).not.toBe("");
    }
  });
});

describe("skillInstallCommand", () => {
  test("targets the agents the installer knows by name", () => {
    expect(skillInstallCommand("claude_code")).toBe("yaak agent install --agent claude-code");
    expect(skillInstallCommand("codex")).toBe("yaak agent install --agent codex");
    expect(skillInstallCommand("cursor")).toBe("yaak agent install --agent cursor");
  });

  test("installs everywhere for agents it cannot target", () => {
    expect(skillInstallCommand("vscode")).toBe("yaak agent install");
    expect(skillInstallCommand("other")).toBe("yaak agent install");
  });
});
