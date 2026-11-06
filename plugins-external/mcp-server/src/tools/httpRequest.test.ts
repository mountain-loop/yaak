import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "@yaakapp/api";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { registerHttpRequestTools } from "./httpRequest";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture({ missing = false, sendError = false } = {}) {
  const httpRequest = { id: "rq_test", workspaceId: "wk_test", url: "http://localhost/echo" };
  const send = vi.fn(async (_args: { httpRequest: unknown; environmentId?: string }) => {
    if (sendError) throw new Error("Environment not found");
    return { httpResponse: { id: "rs_test", status: 200 } };
  });
  // Only the host is mocked; calls go through the real MCP client, schema and transport.
  const yaak = {
    workspace: {
      list: async () => [{ id: "wk_test", name: "Test Workspace" }],
      withContext: () => yaak,
    },
    httpRequest: { getById: async () => (missing ? null : httpRequest), send },
  };
  const server = new McpServer({ name: "yaak-test", version: "0.0.0" });
  registerHttpRequestTools(server, { yaak: yaak as unknown as Context });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, send, httpRequest };
}

test("forwards the advertised environmentId to the host", async () => {
  const { client, send, httpRequest } = await fixture();
  const { tools } = await client.listTools();
  expect(
    tools.find((tool) => tool.name === "send_http_request")?.inputSchema.properties,
  ).toHaveProperty("environmentId");
  const result = await client.callTool({
    name: "send_http_request",
    arguments: { id: httpRequest.id, workspaceId: "wk_test", environmentId: "ev_staging" },
  });
  expect(result.isError).toBeFalsy();
  expect(send).toHaveBeenCalledExactlyOnceWith({ httpRequest, environmentId: "ev_staging" });
});

test("leaves the environment unspecified when omitted", async () => {
  const { client, send, httpRequest } = await fixture();
  const result = await client.callTool({
    name: "send_http_request",
    arguments: { id: httpRequest.id },
  });
  expect(result.isError).toBeFalsy();
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ httpRequest }));
  expect(send.mock.calls[0]?.[0]).not.toHaveProperty("environmentId", expect.any(String));
});

test("does not send a missing request", async () => {
  const { client, send } = await fixture({ missing: true });
  const result = await client.callTool({
    name: "send_http_request",
    arguments: { id: "rq_missing" },
  });
  expect(result.isError).toBe(true);
  expect(send).not.toHaveBeenCalled();
});

test("returns host environment errors to the MCP client", async () => {
  const { client } = await fixture({ sendError: true });
  const result = await client.callTool({
    name: "send_http_request",
    arguments: { id: "rq_test", environmentId: "ev_missing" },
  });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: "Environment not found" }]);
});

test("keeps concurrent environment overrides separate", async () => {
  const { client, send, httpRequest } = await fixture();
  await Promise.all(
    ["ev_a", "ev_b"].map((environmentId) =>
      client.callTool({
        name: "send_http_request",
        arguments: { id: httpRequest.id, environmentId },
      }),
    ),
  );
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledWith({ httpRequest, environmentId: "ev_a" });
  expect(send).toHaveBeenCalledWith({ httpRequest, environmentId: "ev_b" });
});
