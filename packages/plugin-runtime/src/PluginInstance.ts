import console from "node:console";
import { type Stats, statSync, watch } from "node:fs";
import path from "node:path";
import type {
  Context,
  DynamicPromptFormArg,
  PluginDefinition,
} from "@yaakapp/api";
import {
  createPluginContext,
  type PluginTransport,
} from "@yaakapp-internal/lib/pluginContext";
import {
  applyDynamicFormInput,
  migrateTemplateFunctionSelectOptions,
  stripDynamicCallbacks,
} from "@yaakapp-internal/lib/pluginForms";
import {
  applyFormInputDefaults,
  validateTemplateFunctionArgs,
} from "@yaakapp-internal/lib/templateFunction";
import type {
  BootRequest,
  GrpcRequestAction,
  HttpAuthenticationAction,
  HttpRequestAction,
  ImportResources,
  InternalEvent,
  InternalEventPayload,
  PluginContext,
  PromptFormResponse,
  TemplateFunction,
} from "@yaakapp-internal/plugins";
import { EventChannel } from "./EventChannel";

export interface PluginWorkerData {
  bootRequest: BootRequest;
  pluginRefId: string;
  context: PluginContext;
}

export class PluginInstance {
  #workerData: PluginWorkerData;
  #mod: PluginDefinition;
  #pluginToAppEvents: EventChannel;
  #appToPluginEvents: EventChannel;
  #pendingDynamicForms = new Map<string, DynamicPromptFormArg[]>();

  constructor(workerData: PluginWorkerData, pluginEvents: EventChannel) {
    this.#workerData = workerData;
    this.#pluginToAppEvents = pluginEvents;
    this.#appToPluginEvents = new EventChannel();

    // Forward incoming events to onMessage()
    this.#appToPluginEvents.listen(async (event) => {
      await this.#onMessage(event);
    });

    this.#mod = {};

    const fileChangeCallback = async () => {
      const ctx = this.#newCtx(workerData.context);
      try {
        await this.#mod?.dispose?.();
        this.#importModule();
        await this.#mod?.init?.(ctx);
        this.#sendPayload(
          workerData.context,
          {
            type: "reload_response",
            silent: false,
          },
          null,
        );
      } catch (err: unknown) {
        await ctx.toast.show({
          message: `Failed to initialize plugin ${this.#workerData.bootRequest.dir.split("/").pop()}: ${err instanceof Error ? err.message : String(err)}`,
          color: "notice",
          icon: "alert_triangle",
          timeout: 30000,
        });
      }
    };

    if (this.#workerData.bootRequest.watch) {
      watchFile(this.#pathMod(), fileChangeCallback);
      watchFile(this.#pathPkg(), fileChangeCallback);
    }

    this.#importModule();
  }

  postMessage(event: InternalEvent) {
    this.#appToPluginEvents.emit(event);
  }

  async terminate() {
    await this.#mod?.dispose?.();
    this.#pendingDynamicForms.clear();
    this.#unimportModule();
  }

  async #onMessage(event: InternalEvent) {
    const ctx = this.#newCtx(event.context);

    const { context, payload, id: replyId } = event;

    try {
      if (payload.type === "boot_request") {
        await this.#mod?.init?.(ctx);
        this.#sendPayload(context, { type: "boot_response" }, replyId);
        return;
      }

      if (payload.type === "terminate_request") {
        const payload: InternalEventPayload = {
          type: "terminate_response",
        };
        await this.terminate();
        this.#sendPayload(context, payload, replyId);
        return;
      }

      if (
        payload.type === "import_request" &&
        typeof this.#mod?.importer?.onImport === "function"
      ) {
        const reply = await this.#mod.importer.onImport(ctx, {
          text: payload.content,
        });
        if (reply != null) {
          const replyPayload: InternalEventPayload = {
            type: "import_response",
            resources: reply.resources as ImportResources,
          };
          this.#sendPayload(context, replyPayload, replyId);
          return;
        } else {
          // Send back an empty reply (below)
        }
      }

      if (payload.type === "filter_request" && typeof this.#mod?.filter?.onFilter === "function") {
        const reply = await this.#mod.filter.onFilter(ctx, {
          filter: payload.filter,
          payload: payload.content,
          mimeType: payload.type,
        });
        this.#sendPayload(context, { type: "filter_response", ...reply }, replyId);
        return;
      }

      if (
        payload.type === "get_grpc_request_actions_request" &&
        Array.isArray(this.#mod?.grpcRequestActions)
      ) {
        const reply: GrpcRequestAction[] = this.#mod.grpcRequestActions.map((a) => ({
          ...a,
          // Add everything except onSelect
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: "get_grpc_request_actions_response",
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === "get_http_request_actions_request" &&
        Array.isArray(this.#mod?.httpRequestActions)
      ) {
        const reply: HttpRequestAction[] = this.#mod.httpRequestActions.map((a) => ({
          ...a,
          // Add everything except onSelect
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: "get_http_request_actions_response",
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === "get_websocket_request_actions_request" &&
        Array.isArray(this.#mod?.websocketRequestActions)
      ) {
        const reply = this.#mod.websocketRequestActions.map((a) => ({
          ...a,
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: "get_websocket_request_actions_response",
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === "get_workspace_actions_request" &&
        Array.isArray(this.#mod?.workspaceActions)
      ) {
        const reply = this.#mod.workspaceActions.map((a) => ({
          ...a,
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: "get_workspace_actions_response",
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === "get_folder_actions_request" &&
        Array.isArray(this.#mod?.folderActions)
      ) {
        const reply = this.#mod.folderActions.map((a) => ({
          ...a,
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: "get_folder_actions_response",
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (payload.type === "get_themes_request" && Array.isArray(this.#mod?.themes)) {
        const replyPayload: InternalEventPayload = {
          type: "get_themes_response",
          themes: this.#mod.themes,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === "get_template_function_summary_request" &&
        Array.isArray(this.#mod?.templateFunctions)
      ) {
        const functions: TemplateFunction[] = this.#mod.templateFunctions.map(
          (templateFunction) => {
            return {
              ...migrateTemplateFunctionSelectOptions(templateFunction),
              // Add everything except render
              onRender: undefined,
            };
          },
        );
        const replyPayload: InternalEventPayload = {
          type: "get_template_function_summary_response",
          pluginRefId: this.#workerData.pluginRefId,
          functions,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === "get_template_function_config_request" &&
        Array.isArray(this.#mod?.templateFunctions)
      ) {
        const templateFunction = this.#mod.templateFunctions.find((f) => f.name === payload.name);
        if (templateFunction == null) {
          this.#sendEmpty(context, replyId);
          return;
        }

        const fn = {
          ...migrateTemplateFunctionSelectOptions(templateFunction),
          onRender: undefined,
        };

        payload.values = applyFormInputDefaults(fn.args, payload.values);
        const p = { ...payload, purpose: "preview" } as const;
        const resolvedArgs = await applyDynamicFormInput(ctx, fn.args, p);

        const replyPayload: InternalEventPayload = {
          type: "get_template_function_config_response",
          pluginRefId: this.#workerData.pluginRefId,
          function: { ...fn, args: stripDynamicCallbacks(resolvedArgs) },
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (payload.type === "get_http_authentication_summary_request" && this.#mod?.authentication) {
        const replyPayload: InternalEventPayload = {
          type: "get_http_authentication_summary_response",
          ...this.#mod.authentication,
        };

        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (payload.type === "get_http_authentication_config_request" && this.#mod?.authentication) {
        const { args, actions } = this.#mod.authentication;
        payload.values = applyFormInputDefaults(args, payload.values);
        const resolvedArgs = await applyDynamicFormInput(ctx, args, payload);
        const resolvedActions: HttpAuthenticationAction[] = [];
        // oxlint-disable-next-line unbound-method
        for (const { onSelect: _onSelect, ...action } of actions ?? []) {
          resolvedActions.push(action);
        }

        const replyPayload: InternalEventPayload = {
          type: "get_http_authentication_config_response",
          args: stripDynamicCallbacks(resolvedArgs),
          actions: resolvedActions,
          pluginRefId: this.#workerData.pluginRefId,
        };

        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (payload.type === "call_http_authentication_request" && this.#mod?.authentication) {
        const auth = this.#mod.authentication;
        if (typeof auth?.onApply === "function") {
          const resolvedArgs = await applyDynamicFormInput(ctx, auth.args, payload);
          payload.values = applyFormInputDefaults(resolvedArgs, payload.values);
          this.#sendPayload(
            context,
            {
              type: "call_http_authentication_response",
              ...(await auth.onApply(ctx, payload)),
            },
            replyId,
          );
          return;
        }
      }

      if (
        payload.type === "call_http_authentication_action_request" &&
        this.#mod.authentication != null
      ) {
        const action = this.#mod.authentication.actions?.[payload.index];
        if (typeof action?.onSelect === "function") {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === "call_http_request_action_request" &&
        Array.isArray(this.#mod.httpRequestActions)
      ) {
        const action = this.#mod.httpRequestActions[payload.index];
        if (typeof action?.onSelect === "function") {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === "call_websocket_request_action_request" &&
        Array.isArray(this.#mod.websocketRequestActions)
      ) {
        const action = this.#mod.websocketRequestActions[payload.index];
        if (typeof action?.onSelect === "function") {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === "call_workspace_action_request" &&
        Array.isArray(this.#mod.workspaceActions)
      ) {
        const action = this.#mod.workspaceActions[payload.index];
        if (typeof action?.onSelect === "function") {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (payload.type === "call_folder_action_request" && Array.isArray(this.#mod.folderActions)) {
        const action = this.#mod.folderActions[payload.index];
        if (typeof action?.onSelect === "function") {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === "call_grpc_request_action_request" &&
        Array.isArray(this.#mod.grpcRequestActions)
      ) {
        const action = this.#mod.grpcRequestActions[payload.index];
        if (typeof action?.onSelect === "function") {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === "call_template_function_request" &&
        Array.isArray(this.#mod?.templateFunctions)
      ) {
        const fn = this.#mod.templateFunctions.find((a) => a.name === payload.name);
        if (
          payload.args.purpose === "preview" &&
          (fn?.previewType === "click" || fn?.previewType === "none")
        ) {
          // Send empty render response
          this.#sendPayload(
            context,
            {
              type: "call_template_function_response",
              value: null,
              error: "Live preview disabled for this function",
            },
            replyId,
          );
        } else if (typeof fn?.onRender === "function") {
          const resolvedArgs = await applyDynamicFormInput(ctx, fn.args, payload.args);
          const values = applyFormInputDefaults(resolvedArgs, payload.args.values);
          const error = validateTemplateFunctionArgs(fn.name, resolvedArgs, values);
          if (error && payload.args.purpose !== "preview") {
            this.#sendPayload(
              context,
              { type: "call_template_function_response", value: null, error },
              replyId,
            );
            return;
          }

          try {
            const result = await fn.onRender(ctx, { ...payload.args, values });
            this.#sendPayload(
              context,
              { type: "call_template_function_response", value: result ?? null },
              replyId,
            );
          } catch (err) {
            this.#sendPayload(
              context,
              {
                type: "call_template_function_response",
                value: null,
                error: (err instanceof Error ? err.message : String(err)).replace(
                  /^Error:\s*/g,
                  "",
                ),
              },
              replyId,
            );
          }
          return;
        }
      }
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/g, "");
      console.log("Plugin call threw exception", payload.type, "→", error);
      this.#sendPayload(context, { type: "error_response", error }, replyId);
      return;
    }

    // No matches, so send back an empty response so the caller doesn't block forever
    this.#sendEmpty(context, replyId);
  }

  #pathMod() {
    return path.posix.join(this.#workerData.bootRequest.dir, "build", "index.js");
  }

  #pathPkg() {
    return path.join(this.#workerData.bootRequest.dir, "package.json");
  }

  #unimportModule() {
    const id = require.resolve(this.#pathMod());
    delete require.cache[id];
  }

  #importModule() {
    const id = require.resolve(this.#pathMod());
    delete require.cache[id];
    this.#mod = require(id).plugin;
  }

  #buildEventToSend(
    context: PluginContext,
    payload: InternalEventPayload,
    replyId: string | null = null,
  ): InternalEvent {
    return {
      pluginRefId: this.#workerData.pluginRefId,
      pluginName: path.basename(this.#workerData.bootRequest.dir),
      id: genId(),
      replyId,
      payload,
      context,
    };
  }

  #sendPayload(
    context: PluginContext,
    payload: InternalEventPayload,
    replyId: string | null,
  ): string {
    const event = this.#buildEventToSend(context, payload, replyId);
    this.#sendEvent(event);
    return event.id;
  }

  #sendEvent(event: InternalEvent) {
    // if (event.payload.type !== 'empty_response') {
    //   console.log('Sending event to app', this.#pkg.name, event.id, event.payload.type);
    // }
    this.#pluginToAppEvents.emit(event);
  }

  #sendEmpty(context: PluginContext, replyId: string | null = null): string {
    return this.#sendPayload(context, { type: "empty_response" }, replyId);
  }

  /**
   * Send a request to the host and wait for its reply.
   *
   * A host that cannot answer replies with an error, which becomes a thrown
   * error here. The alternative is handing back a reply-shaped object with
   * none of the fields the caller destructures, and letting it fail somewhere
   * further along with no idea why.
   */
  #sendForReply<T extends Omit<InternalEventPayload, "type">>(
    context: PluginContext,
    payload: InternalEventPayload,
  ): Promise<T> {
    // 1. Build event to send
    const eventToSend = this.#buildEventToSend(context, payload, null);

    // 2. Spawn listener in background
    const promise = new Promise<T>((resolve, reject) => {
      const cb = (event: InternalEvent) => {
        if (event.replyId === eventToSend.id) {
          this.#appToPluginEvents.unlisten(cb); // Unlisten, now that we're done
          const { type: _, ...payload } = event.payload;
          if (event.payload.type === "error_response") {
            const { error } = payload as { error?: string };
            reject(new Error(error || `Host failed to handle ${eventToSend.payload.type}`));
            return;
          }
          resolve(payload as T);
        }
      };
      this.#appToPluginEvents.listen(cb);
    });

    // 3. Send the event after we start listening (to prevent race)
    this.#sendEvent(eventToSend);

    // 4. Return the listener promise
    return promise as unknown as Promise<T>;
  }

  #sendAndListenForEvents(
    context: PluginContext,
    payload: InternalEventPayload,
    onEvent: (event: InternalEventPayload) => void,
  ): void {
    // 1. Build event to send
    const eventToSend = this.#buildEventToSend(context, payload, null);

    // 2. Listen for replies in the background
    this.#appToPluginEvents.listen((event: InternalEvent) => {
      if (event.replyId === eventToSend.id) {
        onEvent(event.payload);
      }
    });

    // 3. Send the event after we start listening (to prevent race)
    this.#sendEvent(eventToSend);
  }

  /**
   * How a plugin reaches the app from this runtime.
   *
   * Every request is an event whose reply is matched by id. This runtime can
   * hold a conversation open, so it supplies `stream` and `form`: a window
   * reports navigation until it closes, and a prompt form re-renders as values
   * change. `ctx` itself is built from these in @yaakapp-internal/lib, the same
   * way the sandbox runtime builds it.
   */
  #transport: PluginTransport = {
    request: (context, payload) => this.#sendForReply(context, payload),

    notify: (context, payload) => {
      this.#sendPayload(context, payload, null);
    },

    stream: (context, payload, onReply) => {
      this.#sendAndListenForEvents(context, payload, onReply);
    },

    form: (context, payload, onChange) => {
      // Built by hand so the event id is available: intermediate re-renders
      // reply to the original request rather than starting a new one.
      const eventToSend = this.#buildEventToSend(context, payload, null);

      return new Promise<PromptFormResponse>((resolve) => {
        const cb = (event: InternalEvent) => {
          if (event.replyId !== eventToSend.id) return;
          if (event.payload.type !== "prompt_form_response") return;

          const { done, values } = event.payload as PromptFormResponse;
          if (done) {
            this.#appToPluginEvents.unlisten(cb);
            resolve({ values } as PromptFormResponse);
            return;
          }

          onChange(values ?? {})
            .then((next) => {
              if (next != null) this.#sendPayload(context, next, eventToSend.id);
            })
            .catch((err: unknown) => {
              console.error("Failed to resolve dynamic form inputs", err);
            });
        };
        this.#appToPluginEvents.listen(cb);

        // Sent after the listener is attached, to prevent a race.
        this.#sendEvent(eventToSend);
      });
    },
  };

  #newCtx(context: PluginContext): Context {
    return createPluginContext(this.#transport, context);
  }
}


function genId(len = 5): string {
  const alphabet = "01234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let id = "";
  for (let i = 0; i < len; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

const watchedFiles: Record<string, Stats | null> = {};

/**
 * Watch a file and trigger a callback on change.
 *
 * We also track the stat for each file because fs.watch() will
 * trigger a "change" event when the access date changes.
 */
function watchFile(filepath: string, cb: () => void) {
  watch(filepath, () => {
    const stat = statSync(filepath, { throwIfNoEntry: false });
    if (stat == null || stat.mtimeMs !== watchedFiles[filepath]?.mtimeMs) {
      watchedFiles[filepath] = stat ?? null;
      console.log("[plugin-runtime] watchFile triggered", filepath);
      cb();
    }
  });
}
