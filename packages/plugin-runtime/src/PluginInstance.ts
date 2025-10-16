import {
  BootRequest,
  DeleteKeyValueResponse,
  FindHttpResponsesResponse,
  FormInput,
  GetCookieValueRequest,
  GetCookieValueResponse,
  GetHttpRequestByIdResponse,
  GetKeyValueResponse,
  GrpcRequestAction,
  HttpAuthenticationAction,
  HttpRequestAction,
  InternalEvent,
  InternalEventPayload,
  ListCookieNamesResponse,
  PluginWindowContext,
  PromptTextResponse,
  RenderGrpcRequestResponse,
  RenderHttpRequestResponse,
  SendHttpRequestResponse,
  TemplateFunction,
  TemplateFunctionArg,
  TemplateRenderResponse,
} from '@yaakapp-internal/plugins';
import { Context, PluginDefinition } from '@yaakapp/api';
import { JsonValue } from '@yaakapp/api/lib/bindings/serde_json/JsonValue';
import console from 'node:console';
import { readFileSync, type Stats, statSync, watch } from 'node:fs';
import path from 'node:path';
import { EventChannel } from './EventChannel';
import { migrateTemplateFunctionSelectOptions } from './migrations';

export interface PluginWorkerData {
  bootRequest: BootRequest;
  pluginRefId: string;
}

export class PluginInstance {
  #workerData: PluginWorkerData;
  #mod: PluginDefinition;
  #pkg: { name?: string; version?: string };
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

    // Reload plugin if the JS or package.json changes
    const windowContextNone: PluginWindowContext = { type: 'none' };

    this.#mod = {} as any;
    this.#pkg = JSON.parse(readFileSync(this.#pathPkg(), 'utf8'));

    const fileChangeCallback = async () => {
      await this.#mod?.dispose?.();
      this.#importModule();
      await this.#mod?.init?.(this.#newCtx({ type: 'none' }));
      return this.#sendPayload(
        windowContextNone,
        {
          type: 'reload_response',
          silent: false,
        },
        null,
      );
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
    const ctx = this.#newCtx(event.windowContext);

    const { windowContext, payload, id: replyId } = event;

    try {
      if (payload.type === 'boot_request') {
        await this.#mod?.init?.(ctx);
        this.#sendPayload(windowContext, { type: 'boot_response' }, replyId);
        return;
      }

      if (payload.type === 'terminate_request') {
        const payload: InternalEventPayload = {
          type: 'terminate_response',
        };
        await this.terminate();
        this.#sendPayload(windowContext, payload, replyId);
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
            // deno-lint-ignore no-explicit-any
            resources: reply.resources as any,
          };
          this.#sendPayload(windowContext, replyPayload, replyId);
          return;
        } else {
          // Continue, to send back an empty reply
        }
      }

      if (payload.type === 'filter_request' && typeof this.#mod?.filter?.onFilter === 'function') {
        const reply = await this.#mod.filter.onFilter(ctx, {
          filter: payload.filter,
          payload: payload.content,
          mimeType: payload.type,
        });
        this.#sendPayload(windowContext, { type: 'filter_response', ...reply }, replyId);
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
        this.#sendPayload(windowContext, replyPayload, replyId);
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
        this.#sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_themes_request' && Array.isArray(this.#mod?.themes)) {
        const replyPayload: InternalEventPayload = {
          type: 'get_themes_response',
          themes: this.#mod.themes,
        };
        this.#sendPayload(windowContext, replyPayload, replyId);
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
        this.#sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_template_function_config_request' &&
        Array.isArray(this.#mod?.templateFunctions)
      ) {
        let templateFunction = this.#mod.templateFunctions.find((f) => f.name === payload.name);
        if (templateFunction == null) {
          this.#sendEmpty(windowContext, replyId);
          return;
        }

        templateFunction = migrateTemplateFunctionSelectOptions(templateFunction);
        // @ts-ignore
        delete templateFunction.onRender;
        const resolvedArgs: TemplateFunctionArg[] = [];
        for (const arg of templateFunction.args) {
          if (arg && 'dynamic' in arg) {
            const dynamicAttrs = await arg.dynamic(ctx, payload);
            const { dynamic, ...other } = arg;
            resolvedArgs.push({ ...other, ...dynamicAttrs } as TemplateFunctionArg);
          } else if (arg) {
            resolvedArgs.push(arg);
          }
          templateFunction.args = resolvedArgs;
        }
        const replyPayload: InternalEventPayload = {
          type: 'get_template_function_config_response',
          pluginRefId: this.#workerData.pluginRefId,
          function: templateFunction,
        };
        this.#sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_http_authentication_summary_request' && this.#mod?.authentication) {
        const { name, shortLabel, label } = this.#mod.authentication;
        const replyPayload: InternalEventPayload = {
          type: 'get_http_authentication_summary_response',
          name,
          label,
          shortLabel,
        };

        this.#sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_http_authentication_config_request' && this.#mod?.authentication) {
        const { args, actions } = this.#mod.authentication;
        const resolvedArgs: FormInput[] = [];
        for (const v of args) {
          if (v && 'dynamic' in v) {
            const dynamicAttrs = await v.dynamic(ctx, payload);
            const { dynamic, ...other } = v;
            resolvedArgs.push({ ...other, ...dynamicAttrs } as FormInput);
          } else if (v) {
            resolvedArgs.push(v);
          }
        }
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

        this.#sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'call_http_authentication_request' && this.#mod?.authentication) {
        const auth = this.#mod.authentication;
        if (typeof auth?.onApply === 'function') {
          applyFormInputDefaults(auth.args, payload.values);
          this.#sendPayload(
            windowContext,
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
          this.#sendEmpty(windowContext, replyId);
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
          this.#sendEmpty(windowContext, replyId);
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
          this.#sendEmpty(windowContext, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_template_function_request' &&
        Array.isArray(this.#mod?.templateFunctions)
      ) {
        const fn = this.#mod.templateFunctions.find((a) => a.name === payload.name);
        if (typeof fn?.onRender === 'function') {
          applyFormInputDefaults(fn.args, payload.args.values);
          try {
            const result = await fn.onRender(ctx, payload.args);
            this.#sendPayload(
              windowContext,
              {
                type: 'call_template_function_response',
                value: result ?? null,
              },
              replyId,
            );
          } catch (err) {
            this.#sendPayload(
              windowContext,
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
      this.#sendPayload(windowContext, { type: 'error_response', error }, replyId);
      return;
    }

    // No matches, so send back an empty response so the caller doesn't block forever
    this.#sendEmpty(windowContext, replyId);
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
    windowContext: PluginWindowContext,
    payload: InternalEventPayload,
    replyId: string | null = null,
  ): InternalEvent {
    return {
      pluginRefId: this.#workerData.pluginRefId,
      pluginName: path.basename(this.#workerData.bootRequest.dir),
      id: genId(),
      replyId,
      payload,
      windowContext,
    };
  }

  #sendPayload(
    windowContext: PluginWindowContext,
    payload: InternalEventPayload,
    replyId: string | null,
  ): string {
    const event = this.#buildEventToSend(windowContext, payload, replyId);
    this.#sendEvent(event);
    return event.id;
  }

  #sendEvent(event: InternalEvent) {
    // if (event.payload.type !== 'empty_response') {
    //   console.log('Sending event to app', this.#pkg.name, event.id, event.payload.type);
    // }
    this.#pluginToAppEvents.emit(event);
  }

  #sendEmpty(windowContext: PluginWindowContext, replyId: string | null = null): string {
    return this.#sendPayload(windowContext, { type: 'empty_response' }, replyId);
  }

  #sendAndWaitForReply<T extends Omit<InternalEventPayload, 'type'>>(
    windowContext: PluginWindowContext,
    payload: InternalEventPayload,
  ): Promise<T> {
    // 1. Build event to send
    const eventToSend = this.#buildEventToSend(windowContext, payload, null);

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
    windowContext: PluginWindowContext,
    payload: InternalEventPayload,
    onEvent: (event: InternalEventPayload) => void,
  ): void {
    // 1. Build event to send
    const eventToSend = this.#buildEventToSend(windowContext, payload, null);

    // 2. Listen for replies in the background
    this.#appToPluginEvents.listen((event: InternalEvent) => {
      if (event.replyId === eventToSend.id) {
        onEvent(event.payload);
      }
    });

    // 3. Send the event after we start listening (to prevent race)
    this.#sendEvent(eventToSend);
  }

  #newCtx(windowContext: PluginWindowContext): Context {
    return {
      clipboard: {
        copyText: async (text) => {
          await this.#sendAndWaitForReply(windowContext, {
            type: 'copy_text_request',
            text,
          });
        },
      },
      toast: {
        show: async (args) => {
          await this.#sendAndWaitForReply(windowContext, {
            type: 'show_toast_request',
            // Handle default here because null/undefined both convert to None in Rust translation
            timeout: args.timeout === undefined ? 5000 : args.timeout,
            ...args,
          });
        },
      },
      window: {
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
          this.#sendAndListenForEvents(windowContext, payload, onEvent);
          return {
            close: () => {
              const closePayload: InternalEventPayload = {
                type: 'close_window_request',
                label: args.label,
              };
              this.#sendPayload(windowContext, closePayload, null);
            },
          };
        },
      },
      prompt: {
        text: async (args) => {
          const reply: PromptTextResponse = await this.#sendAndWaitForReply(windowContext, {
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
          const { httpResponses } = await this.#sendAndWaitForReply<FindHttpResponsesResponse>(
            windowContext,
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
          const { grpcRequest } = await this.#sendAndWaitForReply<RenderGrpcRequestResponse>(
            windowContext,
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
          const { httpRequest } = await this.#sendAndWaitForReply<GetHttpRequestByIdResponse>(
            windowContext,
            payload,
          );
          return httpRequest;
        },
        send: async (args) => {
          const payload = {
            type: 'send_http_request_request',
            ...args,
          } as const;
          const { httpResponse } = await this.#sendAndWaitForReply<SendHttpRequestResponse>(
            windowContext,
            payload,
          );
          return httpResponse;
        },
        render: async (args) => {
          const payload = {
            type: 'render_http_request_request',
            ...args,
          } as const;
          const { httpRequest } = await this.#sendAndWaitForReply<RenderHttpRequestResponse>(
            windowContext,
            payload,
          );
          return httpRequest;
        },
      },
      cookies: {
        getValue: async (args: GetCookieValueRequest) => {
          const payload = {
            type: 'get_cookie_value_request',
            ...args,
          } as const;
          const { value } = await this.#sendAndWaitForReply<GetCookieValueResponse>(
            windowContext,
            payload,
          );
          return value;
        },
        listNames: async () => {
          const payload = { type: 'list_cookie_names_request' } as const;
          const { names } = await this.#sendAndWaitForReply<ListCookieNamesResponse>(
            windowContext,
            payload,
          );
          return names;
        },
      },
      templates: {
        /**
         * Invoke Yaak's template engine to render a value. If the value is a nested type
         * (eg. object), it will be recursively rendered.
         */
        render: async (args) => {
          const payload = { type: 'template_render_request', ...args } as const;
          const result = await this.#sendAndWaitForReply<TemplateRenderResponse>(
            windowContext,
            payload,
          );
          return result.data as any;
        },
      },
      store: {
        get: async <T>(key: string) => {
          const payload = { type: 'get_key_value_request', key } as const;
          const result = await this.#sendAndWaitForReply<GetKeyValueResponse>(
            windowContext,
            payload,
          );
          return result.value ? (JSON.parse(result.value) as T) : undefined;
        },
        set: async <T>(key: string, value: T) => {
          const valueStr = JSON.stringify(value);
          const payload: InternalEventPayload = {
            type: 'set_key_value_request',
            key,
            value: valueStr,
          };
          await this.#sendAndWaitForReply<GetKeyValueResponse>(windowContext, payload);
        },
        delete: async (key: string) => {
          const payload = { type: 'delete_key_value_request', key } as const;
          const result = await this.#sendAndWaitForReply<DeleteKeyValueResponse>(
            windowContext,
            payload,
          );
          return result.deleted;
        },
      },
      plugin: {
        reload: () => {
          this.#sendPayload({ type: 'none' }, { type: 'reload_response', silent: true }, null);
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

/** Recursively apply form input defaults to a set of values */
function applyFormInputDefaults(
  inputs: TemplateFunctionArg[],
  values: { [p: string]: JsonValue | undefined },
) {
  for (const input of inputs) {
    if ('inputs' in input) {
      applyFormInputDefaults(input.inputs ?? [], values);
    } else if ('defaultValue' in input && values[input.name] === undefined) {
      values[input.name] = input.defaultValue;
    }
  }
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
