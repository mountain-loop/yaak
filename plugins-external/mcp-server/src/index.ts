import type { Context, PluginDefinition } from "@yaakapp/api";
import { createMcpServer } from "./server.js";

const serverPort = parseInt(process.env.YAAK_PLUGIN_MCP_SERVER_PORT ?? "64343", 10);

let mcpServer: Awaited<ReturnType<typeof createMcpServer>> | null = null;

export const plugin: PluginDefinition = {
  async init(ctx: Context) {
    // Start the server after waiting, so there's an active window open to do things
    // like show the startup toast.
    console.log("Initializing MCP Server plugin");
    setTimeout(async () => {
      void ctx.toast.show({
        message:
          "The MCP Server plugin is deprecated. Install the Yaak CLI, point your agent at `yaak mcp`, then uninstall this plugin.",
        icon: "alert_triangle",
        color: "notice",
        timeout: 30000,
      });
      try {
        mcpServer = createMcpServer({ yaak: ctx }, serverPort);
      } catch (err) {
        console.error("Failed to start MCP server:", err);
        void ctx.toast.show({
          message: `Failed to start MCP Server: ${err instanceof Error ? err.message : String(err)}`,
          icon: "alert_triangle",
          color: "danger",
          timeout: 10000,
        });
      }
    }, 5000);
  },

  async dispose() {
    console.log("Disposing MCP Server plugin");

    if (mcpServer) {
      await mcpServer.close();
      mcpServer = null;
    }
  },
};
