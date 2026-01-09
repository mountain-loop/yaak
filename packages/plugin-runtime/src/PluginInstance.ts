import console from 'node:console';
import { type Stats, statSync, watch } from 'node:fs';
import path from 'node:path';
import type { Context, PluginDefinition } from '@yaakapp/api';
import {
  applyFormInputDefaults,
  validateTemplateFunctionArgs,
} from '@yaakapp-internal/lib/templateFunction';
import type {
  BootRequest,
  DeleteKeyValueResponse,
  DeleteModelResponse,
  FindHttpResponsesResponse,
  GetCookieValueRequest,
  GetCookieValueResponse,
  GetHttpRequestByIdResponse,
  GetKeyValueResponse,
  GrpcRequestAction,
  HttpAuthenticationAction,
  HttpRequest,
  HttpRequestAction,
  ImportResources,
  InternalEvent,
  InternalEventPayload,
  ListCookieNamesResponse,
  ListFoldersResponse,
  ListHttpRequestsRequest,
  ListHttpRequestsResponse,
  ListWorkspacesResponse,
  PluginContext,
  PromptTextResponse,
  RenderGrpcRequestResponse,
  RenderHttpRequestResponse,
  SendHttpRequestResponse,
  TemplateFunction,
  TemplateRenderRequest,
  TemplateRenderResponse,
  UpsertModelResponse,
  WindowInfoResponse,
} from '@yaakapp-internal/plugins';
import { applyDynamicFormInput } from './common';
import { EventChannel } from './EventChannel';
import { migrateTemplateFunctionSelectOptions } from './migrations';

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
      await this.#mod?.dispose?.();
      this.#importModule();
      const ctx = this.#newCtx(workerData.context);
      try {
        await this.#mod?.init?.(ctx);
        this.#sendPayload(
          workerData.context,
          {
            type: 'reload_response',
            silent: false,
          },
          null,
        );
      } catch (err: unknown) {
        ctx.toast.show({
          message: `Failed to initialize plugin ${this.#workerData.bootRequest.dir.split('/').pop()}: ${err}`,
          color: 'notice',
          icon: 'alert_triangle',
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
    this.#unimportModule();
  }

  async #onMessage(event: InternalEvent) {
    const ctx = this.#newCtx(event.context);

    const { context, payload, id: replyId } = event;

    try {
      if (payload.type === 'boot_request') {
        await this.#mod?.init?.(ctx);
        this.#sendPayload(context, { type: 'boot_response' }, replyId);
        return;
      }

      if (payload.type === 'terminate_request') {
        const payload: InternalEventPayload = {
          type: 'terminate_response',
        };
        await this.terminate();
        this.#sendPayload(context, payload, replyId);
        return;
      }

      if (
        payload.type === 'import_request' &&
        typeof this.#mod?.importer?.onImport === 'function'
      ) {
        const reply = await this.#mod.importer.onImport(ctx, {
          text: payload.content,
        });
        if (reply != null) {
          const replyPayload: InternalEventPayload = {
            type: 'import_response',
            resources: reply.resources as ImportResources,
          };
          this.#sendPayload(context, replyPayload, replyId);
          return;
        } else {
          // Send back an empty reply (below)
        }
      }

      if (payload.type === 'filter_request' && typeof this.#mod?.filter?.onFilter === 'function') {
        const reply = await this.#mod.filter.onFilter(ctx, {
          filter: payload.filter,
          payload: payload.content,
          mimeType: payload.type,
        });
        this.#sendPayload(context, { type: 'filter_response', ...reply }, replyId);
        return;
      }

      if (
        payload.type === 'get_grpc_request_actions_request' &&
        Array.isArray(this.#mod?.grpcRequestActions)
      ) {
        const reply: GrpcRequestAction[] = this.#mod.grpcRequestActions.map((a) => ({
          ...a,
          // Add everything except onSelect
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: 'get_grpc_request_actions_response',
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_http_request_actions_request' &&
        Array.isArray(this.#mod?.httpRequestActions)
      ) {
        const reply: HttpRequestAction[] = this.#mod.httpRequestActions.map((a) => ({
          ...a,
          // Add everything except onSelect
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: 'get_http_request_actions_response',
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_websocket_request_actions_request' &&
        Array.isArray(this.#mod?.websocketRequestActions)
      ) {
        const reply = this.#mod.websocketRequestActions.map((a) => ({
          ...a,
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: 'get_websocket_request_actions_response',
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_workspace_actions_request' &&
        Array.isArray(this.#mod?.workspaceActions)
      ) {
        const reply = this.#mod.workspaceActions.map((a) => ({
          ...a,
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: 'get_workspace_actions_response',
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_folder_actions_request' &&
        Array.isArray(this.#mod?.folderActions)
      ) {
        const reply = this.#mod.folderActions.map((a) => ({
          ...a,
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: 'get_folder_actions_response',
          pluginRefId: this.#workerData.pluginRefId,
          actions: reply,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_themes_request' && Array.isArray(this.#mod?.themes)) {
        const replyPayload: InternalEventPayload = {
          type: 'get_themes_response',
          themes: this.#mod.themes,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_template_function_summary_request' &&
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
          type: 'get_template_function_summary_response',
          pluginRefId: this.#workerData.pluginRefId,
          functions,
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_template_function_config_request' &&
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
        const p = { ...payload, purpose: 'preview' } as const;
        const resolvedArgs = await applyDynamicFormInput(ctx, fn.args, p);

        const replyPayload: InternalEventPayload = {
          type: 'get_template_function_config_response',
          pluginRefId: this.#workerData.pluginRefId,
          function: { ...fn, args: resolvedArgs },
        };
        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_http_authentication_summary_request' && this.#mod?.authentication) {
        const replyPayload: InternalEventPayload = {
          type: 'get_http_authentication_summary_response',
          ...this.#mod.authentication,
        };

        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_http_authentication_config_request' && this.#mod?.authentication) {
        const { args, actions } = this.#mod.authentication;
        payload.values = applyFormInputDefaults(args, payload.values);
        const resolvedArgs = await applyDynamicFormInput(ctx, args, payload);
        const resolvedActions: HttpAuthenticationAction[] = [];
        for (const { onSelect, ...action } of actions ?? []) {
          resolvedActions.push(action);
        }

        const replyPayload: InternalEventPayload = {
          type: 'get_http_authentication_config_response',
          args: resolvedArgs,
          actions: resolvedActions,
          pluginRefId: this.#workerData.pluginRefId,
        };

        this.#sendPayload(context, replyPayload, replyId);
        return;
      }

      if (payload.type === 'call_http_authentication_request' && this.#mod?.authentication) {
        const auth = this.#mod.authentication;
        if (typeof auth?.onApply === 'function') {
          auth.args = await applyDynamicFormInput(ctx, auth.args, payload);
          payload.values = applyFormInputDefaults(auth.args, payload.values);
          this.#sendPayload(
            context,
            {
              type: 'call_http_authentication_response',
              ...(await auth.onApply(ctx, payload)),
            },
            replyId,
          );
          return;
        }
      }

      if (
        payload.type === 'call_http_authentication_action_request' &&
        this.#mod.authentication != null
      ) {
        const action = this.#mod.authentication.actions?.[payload.index];
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_http_request_action_request' &&
        Array.isArray(this.#mod.httpRequestActions)
      ) {
        const action = this.#mod.httpRequestActions[payload.index];
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_websocket_request_action_request' &&
        Array.isArray(this.#mod.websocketRequestActions)
      ) {
        const action = this.#mod.websocketRequestActions[payload.index];
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_workspace_action_request' &&
        Array.isArray(this.#mod.workspaceActions)
      ) {
        const action = this.#mod.workspaceActions[payload.index];
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (payload.type === 'call_folder_action_request' && Array.isArray(this.#mod.folderActions)) {
        const action = this.#mod.folderActions[payload.index];
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_grpc_request_action_request' &&
        Array.isArray(this.#mod.grpcRequestActions)
      ) {
        const action = this.#mod.grpcRequestActions[payload.index];
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          this.#sendEmpty(context, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_template_function_request' &&
        Array.isArray(this.#mod?.templateFunctions)
      ) {
        const fn = this.#mod.templateFunctions.find((a) => a.name === payload.name);
        if (
          payload.args.purpose === 'preview' &&
          (fn?.previewType === 'click' || fn?.previewType === 'none')
        ) {
          // Send empty render response
          this.#sendPayload(
            context,
            {
              type: 'call_template_function_response',
              value: null,
              error: 'Live preview disabled for this function',
            },
            replyId,
          );
        } else if (typeof fn?.onRender === 'function') {
          const resolvedArgs = await applyDynamicFormInput(ctx, fn.args, payload.args);
          const values = applyFormInputDefaults(resolvedArgs, payload.args.values);
          const error = validateTemplateFunctionArgs(fn.name, resolvedArgs, values);
          if (error && payload.args.purpose !== 'preview') {
            this.#sendPayload(
              context,
              { type: 'call_template_function_response', value: null, error },
              replyId,
            );
            return;
          }

          try {
            const result = await fn.onRender(ctx, { ...payload.args, values });
            this.#sendPayload(
              context,
              { type: 'call_template_function_response', value: result ?? null },
              replyId,
            );
          } catch (err) {
            this.#sendPayload(
              context,
              {
                type: 'call_template_function_response',
                value: null,
                error: `${err}`.replace(/^Error:\s*/g, ''),
              },
              replyId,
            );
          }
          return;
        }
      }
    } catch (err) {
      const error = `${err}`.replace(/^Error:\s*/g, '');
      console.log('Plugin call threw exception', payload.type, '→', error);
      this.#sendPayload(context, { type: 'error_response', error }, replyId);
      return;
    }

    // No matches, so send back an empty response so the caller doesn't block forever
    this.#sendEmpty(context, replyId);
  }

  #pathMod() {
    return path.posix.join(this.#workerData.bootRequest.dir, 'build', 'index.js');
  }

  #pathPkg() {
    return path.join(this.#workerData.bootRequest.dir, 'package.json');
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
    return this.#sendPayload(context, { type: 'empty_response' }, replyId);
  }

  #sendForReply<T extends Omit<InternalEventPayload, 'type'>>(
    context: PluginContext,
    payload: InternalEventPayload,
  ): Promise<T> {
    // 1. Build event to send
    const eventToSend = this.#buildEventToSend(context, payload, null);

    // 2. Spawn listener in background
    const promise = new Promise<T>((resolve) => {
      const cb = (event: InternalEvent) => {
        if (event.replyId === eventToSend.id) {
          this.#appToPluginEvents.unlisten(cb); // Unlisten, now that we're done
          const { type: _, ...payload } = event.payload;
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

  #newCtx(context: PluginContext): Context {
    const _windowInfo = async () => {
      if (context.label == null) {
        throw new Error("Can't get window context without an active window");
      }
      const payload: InternalEventPayload = {
        type: 'window_info_request',
        label: context.label,
      };

      return this.#sendForReply<WindowInfoResponse>(context, payload);
    };

    return {
      clipboard: {
        copyText: async (text) => {
          await this.#sendForReply(context, {
            type: 'copy_text_request',
            text,
          });
        },
      },
      toast: {
        show: async (args) => {
          await this.#sendForReply(context, {
            type: 'show_toast_request',
            // Handle default here because null/undefined both convert to None in Rust translation
            timeout: args.timeout === undefined ? 5000 : args.timeout,
            ...args,
          });
        },
      },
      window: {
        requestId: async () => {
          return (await _windowInfo()).requestId;
        },
        async workspaceId(): Promise<string | null> {
          return (await _windowInfo()).workspaceId;
        },
        async environmentId(): Promise<string | null> {
          return (await _windowInfo()).environmentId;
        },
        openUrl: async ({ onNavigate, onClose, ...args }) => {
          args.label = args.label || `${Math.random()}`;
          const payload: InternalEventPayload = { type: 'open_window_request', ...args };
          const onEvent = (event: InternalEventPayload) => {
            if (event.type === 'window_navigate_event') {
              onNavigate?.(event);
            } else if (event.type === 'window_close_event') {
              onClose?.();
            }
          };
          this.#sendAndListenForEvents(context, payload, onEvent);
          return {
            close: () => {
              const closePayload: InternalEventPayload = {
                type: 'close_window_request',
                label: args.label,
              };
              this.#sendPayload(context, closePayload, null);
            },
          };
        },
        openExternalUrl: async (url) => {
          await this.#sendForReply(context, {
            type: 'open_external_url_request',
            url,
          });
        },
      },
      prompt: {
        text: async (args) => {
          const reply: PromptTextResponse = await this.#sendForReply(context, {
            type: 'prompt_text_request',
            ...args,
          });
          return reply.value;
        },
      },
      httpResponse: {
        find: async (args) => {
          const payload = {
            type: 'find_http_responses_request',
            ...args,
          } as const;
          const { httpResponses } = await this.#sendForReply<FindHttpResponsesResponse>(
            context,
            payload,
          );
          return httpResponses;
        },
      },
      grpcRequest: {
        render: async (args) => {
          const payload = {
            type: 'render_grpc_request_request',
            ...args,
          } as const;
          const { grpcRequest } = await this.#sendForReply<RenderGrpcRequestResponse>(
            context,
            payload,
          );
          return grpcRequest;
        },
      },
      httpRequest: {
        getById: async (args) => {
          const payload = {
            type: 'get_http_request_by_id_request',
            ...args,
          } as const;
          const { httpRequest } = await this.#sendForReply<GetHttpRequestByIdResponse>(
            context,
            payload,
          );
          return httpRequest;
        },
        send: async (args) => {
          const payload = {
            type: 'send_http_request_request',
            ...args,
          } as const;
          const { httpResponse } = await this.#sendForReply<SendHttpRequestResponse>(
            context,
            payload,
          );
          return httpResponse;
        },
        render: async (args) => {
          const payload = {
            type: 'render_http_request_request',
            ...args,
          } as const;
          const { httpRequest } = await this.#sendForReply<RenderHttpRequestResponse>(
            context,
            payload,
          );
          return httpRequest;
        },
        list: async (args?: { folderId?: string }) => {
          const payload: InternalEventPayload = {
            type: 'list_http_requests_request',
            folderId: args?.folderId,
          } satisfies ListHttpRequestsRequest & { type: 'list_http_requests_request' };
          const { httpRequests } = await this.#sendForReply<ListHttpRequestsResponse>(
            context,
            payload,
          );
          return httpRequests;
        },
        create: async (args) => {
          const payload = {
            type: 'upsert_model_request',
            model: {
              name: '',
              method: 'GET',
              ...args,
              id: '',
              model: 'http_request',
            },
          } as InternalEventPayload;
          const response = await this.#sendForReply<UpsertModelResponse>(context, payload);
          return response.model as HttpRequest;
        },
        update: async (args) => {
          const payload = {
            type: 'upsert_model_request',
            model: {
              model: 'http_request',
              ...args,
            },
          } as InternalEventPayload;
          const response = await this.#sendForReply<UpsertModelResponse>(context, payload);
          return response.model as HttpRequest;
        },
        delete: async (args) => {
          const payload = {
            type: 'delete_model_request',
            model: 'http_request',
            id: args.id,
          } as InternalEventPayload;
          const response = await this.#sendForReply<DeleteModelResponse>(context, payload);
          return response.model as HttpRequest;
        },
      },
      folder: {
        list: async () => {
          const payload = { type: 'list_folders_request' } as const;
          const { folders } = await this.#sendForReply<ListFoldersResponse>(context, payload);
          return folders;
        },
      },
      cookies: {
        getValue: async (args: GetCookieValueRequest) => {
          const payload = {
            type: 'get_cookie_value_request',
            ...args,
          } as const;
          const { value } = await this.#sendForReply<GetCookieValueResponse>(context, payload);
          return value;
        },
        listNames: async () => {
          const payload = { type: 'list_cookie_names_request' } as const;
          const { names } = await this.#sendForReply<ListCookieNamesResponse>(context, payload);
          return names;
        },
      },
      templates: {
        /**
         * Invoke Yaak's template engine to render a value. If the value is a nested type
         * (eg. object), it will be recursively rendered.
         */
        render: async (args: TemplateRenderRequest) => {
          const payload = { type: 'template_render_request', ...args } as const;
          const result = await this.#sendForReply<TemplateRenderResponse>(context, payload);
          // biome-ignore lint/suspicious/noExplicitAny: That's okay
          return result.data as any;
        },
      },
      store: {
        get: async <T>(key: string) => {
          const payload = { type: 'get_key_value_request', key } as const;
          const result = await this.#sendForReply<GetKeyValueResponse>(context, payload);
          return result.value ? (JSON.parse(result.value) as T) : undefined;
        },
        set: async <T>(key: string, value: T) => {
          const valueStr = JSON.stringify(value);
          const payload: InternalEventPayload = {
            type: 'set_key_value_request',
            key,
            value: valueStr,
          };
          await this.#sendForReply<GetKeyValueResponse>(context, payload);
        },
        delete: async (key: string) => {
          const payload = { type: 'delete_key_value_request', key } as const;
          const result = await this.#sendForReply<DeleteKeyValueResponse>(context, payload);
          return result.deleted;
        },
      },
      plugin: {
        reload: () => {
          this.#sendPayload(context, { type: 'reload_response', silent: true }, null);
        },
      },
      workspace: {
        list: async () => {
          const payload = {
            type: 'list_workspaces_request',
          } as InternalEventPayload;
          const response = await this.#sendForReply<ListWorkspacesResponse>(context, payload);
          return response.workspaces.map((w) => {
            // Internal workspace info includes label field not in public API
            type WorkspaceInfoInternal = typeof w & { label?: string };
            return {
              id: w.id,
              name: w.name,
              // Hide label from plugin authors, but keep it for internal routing
              _label: (w as WorkspaceInfoInternal).label as string,
            };
          });
        },
        withContext: (workspaceHandle: { id: string; name: string; _label?: string }) => {
          // Create a new context with the workspace's window label
          const newContext: PluginContext = {
            ...context,
            label: workspaceHandle._label || null,
            workspaceId: workspaceHandle.id,
          };
          return this.#newCtx(newContext);
        },
      },
    };
  }
}

function genId(len = 5): string {
  const alphabet = '01234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id = '';
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
      cb();
    }
  });
}
