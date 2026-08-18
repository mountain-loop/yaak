/**
 * Keeps a sandbox, loads the bundled plugins into it, routes by what each one
 * contributes, and answers the `ctx` calls they make. `hostRequest` below is
 * the whole of what a plugin can do to the world here.
 */

import { PluginSandbox, type PluginSummary } from "@yaakapp-internal/plugin-sandbox";
import type {
  GetHttpAuthenticationConfigResponse,
  GetHttpAuthenticationSummaryResponse,
  GetTemplateFunctionConfigResponse,
  GetTemplateFunctionSummaryResponse,
  ImportResources,
  InternalEventPayload,
  JsonPrimitive,
  PluginContext,
} from "@yaakapp-internal/plugins";
import type { WorkerConnection } from "./connection";
import { SANDBOX_PLUGINS } from "./sandboxPlugins.generated";

type KeyValueRequest = { key: string };

export interface AppliedAuthentication {
  setHeaders?: { name: string; value: string }[] | null;
  setQueryParameters?: { name: string; value: string }[] | null;
}

export class WebPlugins {
  private readonly db: WorkerConnection;
  private sandbox: PluginSandbox | null = null;
  private loading: Promise<void> | null = null;

  private readonly byTemplateFunction = new Map<string, string>();
  private readonly byAuthName = new Map<string, string>();
  private readonly importers: string[] = [];
  private readonly summaries = new Map<string, PluginSummary>();

  constructor(db: WorkerConnection) {
    this.db = db;
  }

  /**
   * Called from every entry point rather than at construction, so a session
   * that never touches a plugin never pays for QuickJS.
   */
  ready(): Promise<void> {
    this.loading ??= this.start();
    return this.loading;
  }

  private async start(): Promise<void> {
    const sandbox = new PluginSandbox({
      onHostRequest: (envelope) => this.hostRequest(envelope),
      onLog: ({ pluginRefId, level, message }) => {
        // Prefixed, or a plugin's console output blames the app's own code.
        const write = level === "error" ? console.error : console.log;
        write(`[plugin ${pluginRefId}] ${message}`);
      },
    });
    this.sandbox = sandbox;

    await Promise.all(
      SANDBOX_PLUGINS.map(async ({ name, source }) => {
        try {
          const summary = await sandbox.load(name, source);
          this.summaries.set(name, summary);
          for (const fn of summary.templateFunctions) this.byTemplateFunction.set(fn, name);
          if (summary.authentication != null) this.byAuthName.set(summary.authentication, name);
          if (summary.importer) this.importers.push(name);
        } catch (err) {
          // One bad bundle should cost its own features and nothing else.
          console.error(`Failed to load plugin \`${name}\``, err);
        }
      }),
    );
  }

  /* ------------------------------ what exists ------------------------------ */

  async templateFunctionSummaries(): Promise<GetTemplateFunctionSummaryResponse[]> {
    await this.ready();
    return this.gather("get_template_function_summary_request", this.summaries.keys());
  }

  async httpAuthenticationSummaries(): Promise<GetHttpAuthenticationSummaryResponse[]> {
    await this.ready();
    return this.gather("get_http_authentication_summary_request", this.byAuthName.values());
  }

  /** One broken plugin must not empty the picker for the others. */
  private async gather<T>(type: string, ids: Iterable<string>): Promise<T[]> {
    const replies = await Promise.all(
      Array.from(ids).map(async (id): Promise<{ type: string } | null> => {
        try {
          return await this.dispatch(id, { type } as InternalEventPayload);
        } catch (err) {
          console.error(`Plugin \`${id}\` failed to answer \`${type}\``, err);
          return null;
        }
      }),
    );
    return replies.filter((r) => r != null && r.type !== "empty_response") as T[];
  }

  /* -------------------------------- calling -------------------------------- */

  async templateFunctionConfig(
    name: string,
    values: Record<string, JsonPrimitive>,
    contextId: string,
  ): Promise<GetTemplateFunctionConfigResponse | null> {
    await this.ready();
    const id = this.byTemplateFunction.get(name);
    if (id == null) return null;
    return this.dispatch(id, {
      type: "get_template_function_config_request",
      contextId,
      name,
      values,
    } as InternalEventPayload);
  }

  /**
   * What the engine's render calls back into. A function nothing provides is a
   * throw naming it, not an empty string: a request sent with a silently blank
   * token is worse than one that refuses to be sent.
   */
  async callTemplateFunction(name: string, argsJson: string): Promise<string> {
    await this.ready();
    const id = this.byTemplateFunction.get(name);
    if (id == null) {
      throw new Error(`No plugin provides the template function \`${name}\``);
    }

    const values = JSON.parse(argsJson) as Record<string, JsonPrimitive>;
    const reply = await this.dispatch<{ value: string | null; error?: string | null }>(id, {
      type: "call_template_function_request",
      name,
      args: { purpose: "send", values },
    } as InternalEventPayload);

    if (reply.error) throw new Error(reply.error);
    return reply.value ?? "";
  }

  async httpAuthenticationConfig(
    authName: string,
    values: Record<string, JsonPrimitive>,
    contextId: string,
  ): Promise<GetHttpAuthenticationConfigResponse | null> {
    await this.ready();
    const id = this.byAuthName.get(authName);
    if (id == null) return null;
    return this.dispatch(id, {
      type: "get_http_authentication_config_request",
      contextId,
      values,
    } as InternalEventPayload);
  }

  async callHttpAuthenticationAction(
    authName: string,
    index: number,
    values: Record<string, JsonPrimitive>,
    contextId: string,
  ): Promise<void> {
    await this.ready();
    const id = this.byAuthName.get(authName);
    if (id == null) throw new Error(`No plugin provides \`${authName}\` authentication`);
    await this.dispatch(id, {
      type: "call_http_authentication_action_request",
      index,
      pluginRefId: id,
      args: { contextId, values },
    } as InternalEventPayload);
  }


  async applyHttpAuthentication(
    authName: string,
    request: {
      contextId: string;
      values: Record<string, JsonPrimitive>;
      method: string;
      url: string;
      headers: { name: string; value: string }[];
      body: string | null;
    },
  ): Promise<AppliedAuthentication> {
    await this.ready();
    const id = this.byAuthName.get(authName);
    if (id == null) {
      throw new Error(
        `This request uses ${authName} authentication, which no plugin in the browser provides`,
      );
    }
    return this.dispatch<AppliedAuthentication>(id, {
      type: "call_http_authentication_request",
      ...request,
    } as InternalEventPayload);
  }

  /** First importer that recognizes the text wins, as `import_data` decides too. */
  async import(content: string): Promise<ImportResources | null> {
    await this.ready();
    for (const id of this.importers) {
      try {
        const reply = await this.dispatch<{ resources?: ImportResources }>(id, {
          type: "import_request",
          content,
        } as InternalEventPayload);
        if (reply.type === "import_response" && reply.resources != null) return reply.resources;
      } catch (err) {
        console.error(`Importer \`${id}\` failed`, err);
      }
    }
    return null;
  }

  /* ------------------------------- internals ------------------------------- */

  private async dispatch<T>(
    pluginRefId: string,
    payload: InternalEventPayload,
  ): Promise<T & { type: string }> {
    if (this.sandbox == null) throw new Error("The plugin sandbox is not running");
    return this.sandbox.dispatch<T>(pluginRefId, this.context(), payload);
  }

  /**
   * `label` names a desktop window, so it stays null and the calls needing one
   * refuse rather than guess which request the user is looking at.
   */
  private context(): PluginContext {
    return { id: "web", label: null, workspaceId: null };
  }

  /**
   * Every addition here is a capability decision, which is why they are written
   * out one at a time instead of forwarded wholesale.
   */
  private async hostRequest(envelope: string): Promise<string> {
    const { pluginRefId, payload } = JSON.parse(envelope) as {
      pluginRefId: string;
      context: PluginContext;
      payload: InternalEventPayload;
    };

    const reply = async (): Promise<InternalEventPayload> => {
      switch (payload.type) {
        case "get_key_value_request": {
          const value = await this.db.rpc<string | null>("web_plugin_kv_get", {
            pluginName: pluginRefId,
            key: (payload as unknown as KeyValueRequest).key,
          });
          return { type: "get_key_value_response", value } as InternalEventPayload;
        }
        case "set_key_value_request": {
          const { key, value } = payload as unknown as { key: string; value: string };
          await this.db.rpc("web_plugin_kv_set", {
            pluginName: pluginRefId,
            key,
            value,
          });
          return { type: "set_key_value_response" } as InternalEventPayload;
        }
        case "delete_key_value_request": {
          const deleted = await this.db.rpc<boolean>("web_plugin_kv_delete", {
            pluginName: pluginRefId,
            key: (payload as unknown as KeyValueRequest).key,
          });
          return { type: "delete_key_value_response", deleted } as InternalEventPayload;
        }

        case "show_toast_request": {
          const { type: _type, ...toast } = payload;
          this.db.deliver("show_toast", toast);
          return { type: "empty_response" };
        }

        default:
          throw new Error(
            `\`${payload.type}\` isn't something a plugin can do when Yaak runs in a browser yet`,
          );
      }
    };

    try {
      return JSON.stringify(await reply());
    } catch (err) {
      return JSON.stringify({
        type: "error_response",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

}
