/**
 * The plugins this host runs, and everything they are allowed to reach.
 *
 * Two jobs. Outward: keep a sandbox, load the bundled plugins into it, and know
 * which of them answers what — the app asks for "the bearer auth config" and
 * this decides that means `auth-bearer`. Inward: answer the `ctx` calls those
 * plugins make, which is where the sandbox stops being a sealed box and starts
 * being a host. Everything a plugin can do to the world is in `hostRequest`
 * below, by name, with a refusal for anything not listed.
 *
 * The plugins are bundled into the app rather than installed, for now — see
 * `scripts/bundle-sandbox-plugins.mjs`. Which three, and why only three, is a
 * decision that belongs to this slice and not to the sandbox: the runtime does
 * not know how many plugins exist.
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

/** What a plugin's own storage is keyed under, matching the desktop's namespacing. */
type KeyValueRequest = { key: string };

export interface AppliedAuthentication {
  setHeaders?: { name: string; value: string }[] | null;
  setQueryParameters?: { name: string; value: string }[] | null;
}

export class WebPlugins {
  private readonly db: WorkerConnection;
  private sandbox: PluginSandbox | null = null;
  private loading: Promise<void> | null = null;

  /** Loaded plugin ids, by what they contribute. */
  private readonly byTemplateFunction = new Map<string, string>();
  private readonly byAuthName = new Map<string, string>();
  private readonly importers: string[] = [];
  private readonly summaries = new Map<string, PluginSummary>();

  constructor(db: WorkerConnection) {
    this.db = db;
  }

  /**
   * Bring the sandbox up and load every bundled plugin, once.
   *
   * Called from every entry point rather than at construction, so a session
   * that never touches a plugin never pays for QuickJS — and so a tab that
   * cannot start the worker still boots the app, with plugin-shaped features
   * failing individually instead of the page failing entirely.
   */
  ready(): Promise<void> {
    this.loading ??= this.start();
    return this.loading;
  }

  private async start(): Promise<void> {
    const sandbox = new PluginSandbox({
      onHostRequest: (envelope) => this.hostRequest(envelope),
      onLog: ({ pluginRefId, level, message }) => {
        // Prefixed, because otherwise a plugin's console output is
        // indistinguishable from the app's own and blames the wrong code.
        const write = level === "error" ? console.error : console.log;
        write(`[plugin ${pluginRefId}] ${message}`);
      },
    });
    this.sandbox = sandbox;

    // In parallel: each is an independent QuickJS context and none of them
    // observes the others.
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

  /**
   * Ask several plugins the same question and keep the answers that came back.
   *
   * A plugin that has nothing to say answers `empty_response`, which is not an
   * answer and is dropped; one that throws is logged and dropped too, so a
   * single broken plugin cannot empty the picker for all the others.
   */
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
   * Run one template function.
   *
   * This is what the engine's render calls back into, so its contract is the
   * engine's: a string, or a throw whose message says what went wrong. A
   * function nothing provides is a throw naming it rather than an empty
   * string, because a request sent with a silently blank token is worse than
   * one that refuses to be sent.
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

  /**
   * Apply an authentication method to a request that is about to be sent.
   *
   * The plugin is shown the request as it stands and hands back headers and
   * query parameters to add — the same exchange the desktop has, at the same
   * point in the send.
   */
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

  /**
   * Import whatever this text turns out to be.
   *
   * Every importer is asked and the first one that recognizes it wins, which
   * is how the desktop's `import_data` decides too — an importer that does not
   * recognize its input returns nothing rather than guessing.
   */
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
   * The context a plugin sees.
   *
   * `label` is null and stays null: it names a desktop window, and the calls
   * that need one — `ctx.window.requestId()` and its neighbours — are refused
   * rather than answered with a guess about which request the user is looking
   * at. `workspaceId` is genuinely unknown here for the same reason; the
   * commands that know it pass it themselves.
   */
  private context(): PluginContext {
    return { id: "web", label: null, workspaceId: null };
  }

  /**
   * Answer one `ctx` call.
   *
   * The list is short on purpose. What is here is what a plugin can do in a
   * browser tab today; what is missing refuses by name, so a plugin that needs
   * it fails with a sentence someone can act on rather than a hang or an
   * undefined. Every addition to this list is a capability decision, which is
   * why they are written out one at a time instead of forwarded wholesale.
   */
  private async hostRequest(envelope: string): Promise<string> {
    const { pluginRefId, payload } = JSON.parse(envelope) as {
      pluginRefId: string;
      context: PluginContext;
      payload: InternalEventPayload;
    };

    const reply = async (): Promise<InternalEventPayload> => {
      switch (payload.type) {
        /* A plugin's own storage, namespaced by plugin in the database. */
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

        /* A message for the user, delivered where every other one is. */
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
