import { describe, expect, test } from "vite-plus/test";
import { AGENT_CLIENTS, appSetup, cliSetup } from "./agentSetup";

const URL = "http://127.0.0.1:64343/mcp";
const TOKEN = "abc123";

describe("cliSetup", () => {
  test("uses each client's own add command", () => {
    expect(cliSetup("claude_code").snippet).toBe("claude mcp add yaak -- yaak mcp");
    expect(cliSetup("codex").snippet).toBe("codex mcp add yaak -- yaak mcp");
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
});

describe("appSetup", () => {
  test("passes the token as a bearer header", () => {
    expect(appSetup("claude_code", URL, TOKEN).snippet).toBe(
      `claude mcp add --transport http yaak ${URL} --header "Authorization: Bearer ${TOKEN}"`,
    );
    expect(appSetup("codex", URL, TOKEN).snippet).toBe(
      `[mcp_servers.yaak]\nurl = "${URL}"\nhttp_headers = { "Authorization" = "Bearer ${TOKEN}" }`,
    );
    expect(JSON.parse(appSetup("cursor", URL, TOKEN).snippet)).toEqual({
      mcpServers: { yaak: { url: URL, headers: { Authorization: `Bearer ${TOKEN}` } } },
    });
    expect(JSON.parse(appSetup("vscode", URL, TOKEN).snippet)).toEqual({
      servers: { yaak: { type: "http", url: URL, headers: { Authorization: `Bearer ${TOKEN}` } } },
    });
    expect(JSON.parse(appSetup("other", URL, TOKEN).snippet)).toEqual({
      mcpServers: {
        yaak: {
          command: "npx",
          args: ["-y", "mcp-remote", URL, "--header", `Authorization: Bearer ${TOKEN}`],
        },
      },
    });
  });

  test("keeps argument lists on one line", () => {
    expect(appSetup("other", URL, TOKEN).snippet).toContain(
      `"args": ["-y", "mcp-remote", "${URL}", "--header", "Authorization: Bearer ${TOKEN}"]`,
    );
  });

  test("covers every listed client", () => {
    for (const { value } of AGENT_CLIENTS) {
      expect(cliSetup(value).snippet).not.toBe("");
      expect(appSetup(value, URL, TOKEN).snippet).toContain(TOKEN);
    }
  });
});
