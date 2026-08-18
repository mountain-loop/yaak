/**
 * The runtime shell, as it exists inside the sandbox.
 *
 * This is the whole of what QuickJS evaluates before any untrusted code does:
 * it installs the globals, loads one module, and answers events against it.
 * The Node runtime's `PluginInstance` does the same job on the other side of a
 * WebSocket; the difference is that this one has no filesystem to load from and
 * no host objects to reach for, so the module arrives as source text and every
 * capability arrives as a reply.
 *
 * It is deliberately not plugin-shaped underneath. `load` takes source and
 * `dispatch` takes an event: what a module *is* — a plugin today, a workspace
 * script later — is decided by the payloads the host sends, not by this file.
 * Scripts are the reason that matters. A plugin is installed, so someone
 * consented to it; a script arrives inside a workspace, as data, with no such
 * moment, which is why scripts will never get a runtime other than this one.
 */

import type { PluginDefinition } from "@yaakapp/api";
import {
  applyFormInputDefaults,
  validateTemplateFunctionArgs,
} from "@yaakapp-internal/lib/templateFunction";
import {
  applyDynamicFormInput,
  migrateTemplateFunctionSelectOptions,
  stripDynamicCallbacks,
} from "@yaakapp-internal/lib/pluginForms";
import type {
  GrpcRequestAction,
  HttpAuthenticationAction,
  HttpRequestAction,
  ImportResources,
  InternalEventPayload,
  PluginContext,
  TemplateFunction,
} from "@yaakapp-internal/plugins";
import {
  createPluginContext,
  type PluginTransport,
} from "@yaakapp-internal/lib/pluginContext";
import { installGlobals } from "./globals";

declare const __yaak_call: (payloadJson: string) => Promise<string>;

const { fireTimer } = installGlobals();

/** The loaded module, and the id the host knows it by. */
let mod: PluginDefinition = {};
let pluginRefId = "";

/**
 * Evaluate a module's source.
 *
 * The bundles are CommonJS, so they are handed the three names that implies and
 * nothing else. `require` is the interesting one: it exists only to fail, by
 * name, because a bundle that still calls it did not get bundled for this
 * target and the honest outcome is a message saying which specifier is missing
 * rather than an undefined that surfaces ten frames later.
 */
function load(source: string, refId: string): void {
  const module: { exports: Record<string, unknown> } = { exports: {} };
  const require = (specifier: string) => {
    throw new Error(
      `Module "${specifier}" is not available in the sandbox runtime. ` +
        `Plugins must be bundled with no external or built-in modules.`,
    );
  };

  // `new Function` rather than an ES module so the bundle's own top-level names
  // cannot collide with this shell's, and so the source can arrive as a string
  // with no loader hook. Evaluating untrusted source is the entire job of this
  // file; the isolation is the QuickJS context around it, not a lint rule.
  // oxlint-disable-next-line no-implied-eval
  const factory = new Function("module", "exports", "require", source);
  factory(module, module.exports, require);

  const loaded = (module.exports.plugin ?? module.exports.default) as PluginDefinition | undefined;
  if (loaded == null || typeof loaded !== "object") {
    throw new Error("Module did not export `plugin`");
  }
  mod = loaded;
  pluginRefId = refId;
}

/** Everything a module contributes, without the functions that implement it. */
function summary(): Record<string, unknown> {
  return {
    templateFunctions: (mod.templateFunctions ?? []).map((f) => f.name),
    authentication: mod.authentication?.name ?? null,
    importer: mod.importer != null,
    filter: mod.filter != null,
    themes: (mod.themes ?? []).length,
    httpRequestActions: (mod.httpRequestActions ?? []).length,
    workspaceActions: (mod.workspaceActions ?? []).length,
    folderActions: (mod.folderActions ?? []).length,
    grpcRequestActions: (mod.grpcRequestActions ?? []).length,
    websocketRequestActions: (mod.websocketRequestActions ?? []).length,
  };
}

const EMPTY: InternalEventPayload = { type: "empty_response" };

/**
 * Answer one event against the loaded module.
 *
 * Every branch mirrors the Node runtime's, because the payloads are the same
 * payloads — a plugin cannot tell which runtime it is in, and that is the
 * promise the whole design exists to keep. An unmatched event gets
 * `empty_response` rather than silence, so a caller never waits forever for a
 * capability this module doesn't have.
 */
/**
 * How a plugin reaches the world from in here: one JSON envelope out, one back.
 *
 * No `stream` and no `form`, and that is the honest shape rather than a
 * shortcut. Both need the host to hold a conversation open, which the sandbox
 * protocol deliberately does not do — so `ctx.window.openUrl` refuses and a
 * prompt form is drawn once from its defaults, instead of either quietly doing
 * nothing.
 */
const transport: PluginTransport = {
  async request(context, payload) {
    const replyJson = await __yaak_call(
      // The id rides along because the host multiplexes every loaded module
      // through one handler, and a plugin's storage is namespaced by which
      // plugin it is.
      JSON.stringify({ pluginRefId, context, payload }),
    );
    const reply = JSON.parse(replyJson) as InternalEventPayload & { error?: string };
    if (reply.type === "error_response") {
      throw new Error(reply.error || `Host failed to handle ${payload.type}`);
    }
    const { type: _type, ...rest } = reply;
    return rest as Record<string, unknown>;
  },
  notify(context, payload) {
    void __yaak_call(JSON.stringify({ pluginRefId, context, payload }));
  },
};

async function dispatch(
  context: PluginContext,
  payload: InternalEventPayload,
): Promise<InternalEventPayload> {
  const ctx = createPluginContext(transport, context);

  if (payload.type === "boot_request") {
    await mod.init?.(ctx);
    return { type: "boot_response" };
  }

  if (payload.type === "terminate_request") {
    await mod.dispose?.();
    return { type: "terminate_response" };
  }

  if (payload.type === "import_request" && typeof mod.importer?.onImport === "function") {
    const reply = await mod.importer.onImport(ctx, { text: payload.content });
    if (reply != null) {
      return { type: "import_response", resources: reply.resources as ImportResources };
    }
    return EMPTY;
  }

  if (payload.type === "filter_request" && typeof mod.filter?.onFilter === "function") {
    const reply = await mod.filter.onFilter(ctx, {
      filter: payload.filter,
      payload: payload.content,
      mimeType: payload.type,
    });
    return { type: "filter_response", ...reply };
  }

  if (payload.type === "get_themes_request" && Array.isArray(mod.themes)) {
    return { type: "get_themes_response", themes: mod.themes };
  }

  /* --------------------------- template functions -------------------------- */

  if (
    payload.type === "get_template_function_summary_request" &&
    Array.isArray(mod.templateFunctions)
  ) {
    const functions: TemplateFunction[] = mod.templateFunctions.map((f) => ({
      ...migrateTemplateFunctionSelectOptions(f),
      onRender: undefined,
    }));
    return { type: "get_template_function_summary_response", pluginRefId, functions };
  }

  if (
    payload.type === "get_template_function_config_request" &&
    Array.isArray(mod.templateFunctions)
  ) {
    const found = mod.templateFunctions.find((f) => f.name === payload.name);
    if (found == null) return EMPTY;

    const fn = { ...migrateTemplateFunctionSelectOptions(found), onRender: undefined };
    payload.values = applyFormInputDefaults(fn.args, payload.values);
    const resolved = await applyDynamicFormInput(ctx, fn.args, {
      ...payload,
      purpose: "preview",
    } as const);

    return {
      type: "get_template_function_config_response",
      pluginRefId,
      function: { ...fn, args: stripDynamicCallbacks(resolved) },
    };
  }

  if (payload.type === "call_template_function_request" && Array.isArray(mod.templateFunctions)) {
    const fn = mod.templateFunctions.find((f) => f.name === payload.name);

    if (
      payload.args.purpose === "preview" &&
      (fn?.previewType === "click" || fn?.previewType === "none")
    ) {
      return {
        type: "call_template_function_response",
        value: null,
        error: "Live preview disabled for this function",
      };
    }

    if (typeof fn?.onRender === "function") {
      const resolved = await applyDynamicFormInput(ctx, fn.args, payload.args);
      const values = applyFormInputDefaults(resolved, payload.args.values);
      const error = validateTemplateFunctionArgs(fn.name, resolved, values);
      if (error && payload.args.purpose !== "preview") {
        return { type: "call_template_function_response", value: null, error };
      }

      const result = await fn.onRender(ctx, { ...payload.args, values });
      return { type: "call_template_function_response", value: result ?? null };
    }
  }

  /* --------------------------- http authentication ------------------------- */

  if (payload.type === "get_http_authentication_summary_request" && mod.authentication) {
    return { type: "get_http_authentication_summary_response", ...mod.authentication };
  }

  if (payload.type === "get_http_authentication_config_request" && mod.authentication) {
    const { args, actions } = mod.authentication;
    payload.values = applyFormInputDefaults(args, payload.values);
    const resolved = await applyDynamicFormInput(ctx, args, payload);
    const resolvedActions: HttpAuthenticationAction[] = [];
    // oxlint-disable-next-line unbound-method
    for (const { onSelect: _onSelect, ...action } of actions ?? []) resolvedActions.push(action);

    return {
      type: "get_http_authentication_config_response",
      args: stripDynamicCallbacks(resolved),
      actions: resolvedActions,
      pluginRefId,
    };
  }

  if (payload.type === "call_http_authentication_request" && mod.authentication) {
    const auth = mod.authentication;
    if (typeof auth.onApply === "function") {
      const resolved = await applyDynamicFormInput(ctx, auth.args, payload);
      payload.values = applyFormInputDefaults(resolved, payload.values);
      return { type: "call_http_authentication_response", ...(await auth.onApply(ctx, payload)) };
    }
  }

  if (payload.type === "call_http_authentication_action_request" && mod.authentication != null) {
    const action = mod.authentication.actions?.[payload.index];
    if (typeof action?.onSelect === "function") {
      await action.onSelect(ctx, payload.args);
      return EMPTY;
    }
  }

  /* --------------------------------- actions ------------------------------- */

  if (payload.type === "get_http_request_actions_request" && Array.isArray(mod.httpRequestActions)) {
    const actions: HttpRequestAction[] = mod.httpRequestActions.map((a) => ({
      ...a,
      onSelect: undefined,
    }));
    return { type: "get_http_request_actions_response", pluginRefId, actions };
  }

  if (
    payload.type === "get_websocket_request_actions_request" &&
    Array.isArray(mod.websocketRequestActions)
  ) {
    const actions = mod.websocketRequestActions.map((a) => ({ ...a, onSelect: undefined }));
    return { type: "get_websocket_request_actions_response", pluginRefId, actions };
  }

  if (payload.type === "get_grpc_request_actions_request" && Array.isArray(mod.grpcRequestActions)) {
    const actions: GrpcRequestAction[] = mod.grpcRequestActions.map((a) => ({
      ...a,
      onSelect: undefined,
    }));
    return { type: "get_grpc_request_actions_response", pluginRefId, actions };
  }

  if (payload.type === "get_workspace_actions_request" && Array.isArray(mod.workspaceActions)) {
    const actions = mod.workspaceActions.map((a) => ({ ...a, onSelect: undefined }));
    return { type: "get_workspace_actions_response", pluginRefId, actions };
  }

  if (payload.type === "get_folder_actions_request" && Array.isArray(mod.folderActions)) {
    const actions = mod.folderActions.map((a) => ({ ...a, onSelect: undefined }));
    return { type: "get_folder_actions_response", pluginRefId, actions };
  }

  const called = await callAction(ctx, payload);
  if (called) return EMPTY;

  return EMPTY;
}

/** The five action kinds, which differ only in which list they index into. */
async function callAction(
  ctx: ReturnType<typeof createPluginContext>,
  payload: InternalEventPayload,
): Promise<boolean> {
  const lists = {
    call_http_request_action_request: mod.httpRequestActions,
    call_websocket_request_action_request: mod.websocketRequestActions,
    call_grpc_request_action_request: mod.grpcRequestActions,
    call_workspace_action_request: mod.workspaceActions,
    call_folder_action_request: mod.folderActions,
  } as const;

  const list = lists[payload.type as keyof typeof lists];
  if (!Array.isArray(list)) return false;

  const action = list[(payload as { index: number }).index];
  if (typeof action?.onSelect !== "function") return false;

  await action.onSelect(ctx, (payload as { args: never }).args);
  return true;
}


/**
 * What the host can reach.
 *
 * Named on `globalThis` because the host calls them by evaluating an
 * expression, and kept to four: load a module, ask what it has, send it an
 * event, wake a timer.
 */
(globalThis as Record<string, unknown>).__yaak_guest = {
  load,
  summary,
  fireTimer,
  dispatch: async (envelopeJson: string): Promise<string> => {
    const { context, payload } = JSON.parse(envelopeJson) as {
      context: PluginContext;
      payload: InternalEventPayload;
    };
    try {
      return JSON.stringify(await dispatch(context, payload));
    } catch (err) {
      // A throw from inside a plugin is an answer, not a crash: the host turns
      // it into the same `error_response` the Node runtime sends, and whatever
      // asked for this gets a message instead of a hang.
      const error = (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/g, "");
      return JSON.stringify({ type: "error_response", error });
    }
  },
};
