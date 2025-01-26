// OAuth 2.0 spec -> https://datatracker.ietf.org/doc/html/rfc6749

import type {
  BootRequest,
  Context,
  DeleteKeyValueResponse,
  FindHttpResponsesResponse,
  FormInput,
  GetHttpRequestByIdResponse,
  GetKeyValueResponse,
  HttpAuthenticationAction,
  HttpRequestAction,
  InternalEvent,
  InternalEventPayload,
  JsonPrimitive,
  PluginDefinition,
  PromptTextResponse,
  RenderHttpRequestResponse,
  SendHttpRequestResponse,
  TemplateFunction,
  TemplateRenderResponse,
  WindowContext,
} from '@yaakapp/api';
import * as console from 'node:console';
import type { Stats } from 'node:fs';
import { readFileSync, statSync, watch } from 'node:fs';
import path from 'node:path';
import * as util from 'node:util';
import { parentPort as nullableParentPort, workerData } from 'node:worker_threads';
import Promise from '../../../../../Library/Caches/deno/npm/registry.npmjs.org/any-promise/1.3.0';
import { interceptStdout } from './interceptStdout';
import { migrateHttpRequestActionKey, migrateTemplateFunctionSelectOptions } from './migrations';

if (nullableParentPort == null) {
  throw new Error('Worker does not have access to parentPort');
}

const parentPort = nullableParentPort;

export interface PluginWorkerData {
  bootRequest: BootRequest;
  pluginRefId: string;
}

function initialize(workerData: PluginWorkerData) {
  const {
    bootRequest: { dir: pluginDir, watch: enableWatch },
    pluginRefId,
  }: PluginWorkerData = workerData;

  const pathPkg = path.join(pluginDir, 'package.json');
  const pathMod = path.posix.join(pluginDir, 'build', 'index.js');

  const pkg = JSON.parse(readFileSync(pathPkg, 'utf8'));

  prefixStdout(`[plugin][${pkg.name}] %s`);

  function buildEventToSend(
    windowContext: WindowContext,
    payload: InternalEventPayload,
    replyId: string | null = null,
  ): InternalEvent {
    return {
      pluginRefId,
      pluginName: path.basename(pluginDir),
      id: genId(),
      replyId,
      payload,
      windowContext,
    };
  }

  function sendEmpty(windowContext: WindowContext, replyId: string | null = null): string {
    return sendPayload(windowContext, { type: 'empty_response' }, replyId);
  }

  function sendPayload(
    windowContext: WindowContext,
    payload: InternalEventPayload,
    replyId: string | null,
  ): string {
    const event = buildEventToSend(windowContext, payload, replyId);
    sendEvent(event);
    return event.id;
  }

  function sendEvent(event: InternalEvent) {
    if (event.payload.type !== 'empty_response') {
      console.log('Sending event to app', event.id, event.payload.type);
    }
    parentPort.postMessage(event);
  }

  function sendAndWaitForReply<T extends Omit<InternalEventPayload, 'type'>>(
    windowContext: WindowContext,
    payload: InternalEventPayload,
  ): Promise<T> {
    // 1. Build event to send
    const eventToSend = buildEventToSend(windowContext, payload, null);

    // 2. Spawn listener in background
    const promise = new Promise<T>((resolve) => {
      const cb = (event: InternalEvent) => {
        if (event.replyId === eventToSend.id) {
          parentPort.off('message', cb); // Unlisten, now that we're done
          const { type: _, ...payload } = event.payload;
          resolve(payload as T);
        }
      };
      parentPort.on('message', cb);
    });

    // 3. Send the event after we start listening (to prevent race)
    sendEvent(eventToSend);

    // 4. Return the listener promise
    return promise as unknown as Promise<T>;
  }

  function sendAndListenForEvents(
    windowContext: WindowContext,
    payload: InternalEventPayload,
    onEvent: (event: InternalEventPayload) => void,
  ): void {
    // 1. Build event to send
    const eventToSend = buildEventToSend(windowContext, payload, null);

    // 2. Listen for replies in the background
    parentPort.on('message', (event: InternalEvent) => {
      if (event.replyId === eventToSend.id) {
        onEvent(event.payload);
      }
    });

    // 3. Send the event after we start listening (to prevent race)
    sendEvent(eventToSend);
  }

  // Reload plugin if the JS or package.json changes
  const windowContextNone: WindowContext = { type: 'none' };
  const fileChangeCallback = async () => {
    importModule();
    return sendPayload(windowContextNone, { type: 'reload_response' }, null);
  };

  if (enableWatch) {
    watchFile(pathMod, fileChangeCallback);
    watchFile(pathPkg, fileChangeCallback);
  }

  const newCtx = (event: InternalEvent): Context => ({
    clipboard: {
      async copyText(text) {
        await sendAndWaitForReply(event.windowContext, {
          type: 'copy_text_request',
          text,
        });
      },
    },
    toast: {
      async show(args) {
        await sendAndWaitForReply(event.windowContext, {
          type: 'show_toast_request',
          ...args,
        });
      },
    },
    window: {
      async openUrl({ onNavigate, ...args }) {
        args.label = args.label || `${Math.random()}`;
        const payload: InternalEventPayload = { type: 'open_window_request', ...args };
        const onEvent = (event: InternalEventPayload) => {
          if (event.type === 'window_navigate_event') {
            onNavigate?.(event);
          }
        };
        sendAndListenForEvents(event.windowContext, payload, onEvent);
        return {
          close: () => {
            const closePayload: InternalEventPayload = {
              type: 'close_window_request',
              label: args.label,
            };
            sendPayload(event.windowContext, closePayload, null);
          },
        };
      },
    },
    prompt: {
      async text(args) {
        const reply: PromptTextResponse = await sendAndWaitForReply(event.windowContext, {
          type: 'prompt_text_request',
          ...args,
        });
        return reply.value;
      },
    },
    httpResponse: {
      async find(args) {
        const payload = {
          type: 'find_http_responses_request',
          ...args,
        } as const;
        const { httpResponses } = await sendAndWaitForReply<FindHttpResponsesResponse>(
          event.windowContext,
          payload,
        );
        return httpResponses;
      },
    },
    httpRequest: {
      async getById(args) {
        const payload = {
          type: 'get_http_request_by_id_request',
          ...args,
        } as const;
        const { httpRequest } = await sendAndWaitForReply<GetHttpRequestByIdResponse>(
          event.windowContext,
          payload,
        );
        return httpRequest;
      },
      async send(args) {
        const payload = {
          type: 'send_http_request_request',
          ...args,
        } as const;
        const { httpResponse } = await sendAndWaitForReply<SendHttpRequestResponse>(
          event.windowContext,
          payload,
        );
        return httpResponse;
      },
      async render(args) {
        const payload = {
          type: 'render_http_request_request',
          ...args,
        } as const;
        const { httpRequest } = await sendAndWaitForReply<RenderHttpRequestResponse>(
          event.windowContext,
          payload,
        );
        return httpRequest;
      },
    },
    templates: {
      /**
       * Invoke Yaak's template engine to render a value. If the value is a nested type
       * (eg. object), it will be recursively rendered.
       */
      async render(args) {
        const payload = { type: 'template_render_request', ...args } as const;
        const result = await sendAndWaitForReply<TemplateRenderResponse>(
          event.windowContext,
          payload,
        );
        return result.data;
      },
    },
    store: {
      async get<T>(key: string) {
        const payload = { type: 'get_key_value_request', key } as const;
        const result = await sendAndWaitForReply<GetKeyValueResponse>(event.windowContext, payload);
        return result.value ? (JSON.parse(result.value) as T) : undefined;
      },
      async set<T>(key: string, value: T) {
        const valueStr = JSON.stringify(value);
        const payload: InternalEventPayload = {
          type: 'set_key_value_request',
          key,
          value: valueStr,
        };
        await sendAndWaitForReply<GetKeyValueResponse>(event.windowContext, payload);
      },
      async delete(key: string) {
        const payload = { type: 'delete_key_value_request', key } as const;
        const result = await sendAndWaitForReply<DeleteKeyValueResponse>(
          event.windowContext,
          payload,
        );
        return result.deleted;
      },
    },
  });

  let plug: PluginDefinition | null = null;

  function importModule() {
    const id = require.resolve(pathMod);
    delete require.cache[id];
    plug = require(id).plugin;
  }

  importModule();

  // Message comes into the plugin to be processed
  parentPort.on('message', async (event: InternalEvent) => {
    const ctx = newCtx(event);
    const { windowContext, payload, id: replyId } = event;
    try {
      if (payload.type === 'boot_request') {
        // console.log('Plugin initialized', pkg.name, { capabilities, enableWatch });
        const payload: InternalEventPayload = {
          type: 'boot_response',
          name: pkg.name,
          version: pkg.version,
        };
        sendPayload(windowContext, payload, replyId);
        return;
      }

      if (payload.type === 'terminate_request') {
        const payload: InternalEventPayload = {
          type: 'terminate_response',
        };
        sendPayload(windowContext, payload, replyId);
        return;
      }

      if (payload.type === 'import_request' && typeof plug?.importer?.onImport === 'function') {
        const reply = await plug.importer.onImport(ctx, {
          text: payload.content,
        });
        if (reply != null) {
          const replyPayload: InternalEventPayload = {
            type: 'import_response',
            // deno-lint-ignore no-explicit-any
            resources: reply.resources as any,
          };
          sendPayload(windowContext, replyPayload, replyId);
          return;
        } else {
          // Continue, to send back an empty reply
        }
      }

      if (payload.type === 'filter_request' && typeof plug?.filter?.onFilter === 'function') {
        const reply = await plug.filter.onFilter(ctx, {
          filter: payload.filter,
          payload: payload.content,
          mimeType: payload.type,
        });
        const replyPayload: InternalEventPayload = {
          type: 'filter_response',
          content: reply.filtered,
        };
        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_http_request_actions_request' &&
        Array.isArray(plug?.httpRequestActions)
      ) {
        const reply: HttpRequestAction[] = plug.httpRequestActions.map((a) => ({
          ...migrateHttpRequestActionKey(a),
          // Add everything except onSelect
          onSelect: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: 'get_http_request_actions_response',
          pluginRefId,
          actions: reply,
        };
        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_template_functions_request' &&
        Array.isArray(plug?.templateFunctions)
      ) {
        const reply: TemplateFunction[] = plug.templateFunctions.map((templateFunction) => {
          return {
            ...migrateTemplateFunctionSelectOptions(templateFunction),
            // Add everything except render
            onRender: undefined,
          };
        });
        const replyPayload: InternalEventPayload = {
          type: 'get_template_functions_response',
          pluginRefId,
          functions: reply,
        };
        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_http_authentication_summary_request' && plug?.authentication) {
        const { name, shortLabel, label } = plug.authentication;
        const replyPayload: InternalEventPayload = {
          type: 'get_http_authentication_summary_response',
          name,
          label,
          shortLabel,
        };

        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_http_authentication_config_request' && plug?.authentication) {
        const { args, actions } = plug.authentication;
        const resolvedArgs: FormInput[] = [];
        for (let i = 0; i < args.length; i++) {
          let v = args[i];
          if ('dynamic' in v) {
            const dynamicAttrs = await v.dynamic(ctx, payload);
            const { dynamic, ...other } = v;
            resolvedArgs.push({ ...other, ...dynamicAttrs } as FormInput);
          } else {
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
          pluginRefId,
        };

        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'call_http_authentication_request' && plug?.authentication) {
        const auth = plug.authentication;
        if (typeof auth?.onApply === 'function') {
          applyFormInputDefaults(auth.args, payload.values);
          const result = await auth.onApply(ctx, payload);
          sendPayload(
            windowContext,
            {
              type: 'call_http_authentication_response',
              setHeaders: result.setHeaders,
            },
            replyId,
          );
          return;
        }
      }

      if (
        payload.type === 'call_http_authentication_action_request' &&
        plug?.authentication != null
      ) {
        const action = plug.authentication.actions?.find((a) => a.name === payload.name);
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          sendEmpty(windowContext, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_http_request_action_request' &&
        Array.isArray(plug?.httpRequestActions)
      ) {
        const action = plug.httpRequestActions.find(
          (a) => migrateHttpRequestActionKey(a).name === payload.name,
        );
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          sendEmpty(windowContext, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_template_function_request' &&
        Array.isArray(plug?.templateFunctions)
      ) {
        const action = plug.templateFunctions.find((a) => a.name === payload.name);
        if (typeof action?.onRender === 'function') {
          applyFormInputDefaults(action.args, payload.args.values);
          const result = await action.onRender(ctx, payload.args);
          sendPayload(
            windowContext,
            {
              type: 'call_template_function_response',
              value: result ?? null,
            },
            replyId,
          );
          return;
        }
      }

      if (payload.type === 'reload_request') {
        importModule();
      }
    } catch (err) {
      console.log('Plugin call threw exception', payload.type, err);
      sendPayload(
        windowContext,
        {
          type: 'error_response',
          error: `${err}`,
        },
        replyId,
      );
      return;
    }

    // No matches, so send back an empty response so the caller doesn't block forever
    sendEmpty(windowContext, replyId);
  });
}

initialize(workerData);

function genId(len = 5): string {
  const alphabet = '01234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id = '';
  for (let i = 0; i < len; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function prefixStdout(s: string) {
  if (!s.includes('%s')) {
    throw new Error('Console prefix must contain a "%s" replacer');
  }
  interceptStdout((text: string) => {
    const lines = text.split(/\n/);
    let newText = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] == '') continue;
      newText += util.format(s, lines[i]) + '\n';
    }
    return newText.trimEnd();
  });
}

const watchedFiles: Record<string, Stats> = {};

/**
 * Watch a file and trigger callback on change.
 *
 * We also track the stat for each file because fs.watch() will
 * trigger a "change" event when the access date changes
 */
function watchFile(filepath: string, cb: (filepath: string) => void) {
  watch(filepath, () => {
    const stat = statSync(filepath);
    if (stat.mtimeMs !== watchedFiles[filepath]?.mtimeMs) {
      cb(filepath);
    }
    watchedFiles[filepath] = stat;
  });
}

/** Recursively apply form input defaults to a set of values */
function applyFormInputDefaults(
  inputs: FormInput[],
  values: { [p: string]: JsonPrimitive | undefined },
) {
  for (const input of inputs) {
    if ('inputs' in input) {
      applyFormInputDefaults(input.inputs ?? [], values);
    } else if ('defaultValue' in input && values[input.name] === undefined) {
      values[input.name] = input.defaultValue;
    }
  }
}
