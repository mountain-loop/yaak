import type {
  BootRequest,
  Context,
  FindHttpResponsesResponse,
  GetHttpRequestByIdResponse,
  HttpRequestAction,
  InternalEvent,
  InternalEventPayload,
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
import { interceptStdout } from './interceptStdout';
import { parentPort, workerData } from 'node:worker_threads';

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
    parentPort!.postMessage(event);
  }

  function sendAndWaitForReply<T extends Omit<InternalEventPayload, 'type'>>(
    windowContext: WindowContext,
    payload: InternalEventPayload,
  ): Promise<T> {
    // 1. Build event to send
    const eventToSend = buildEventToSend(windowContext, payload, null);

    // 2. Spawn listener in background
    const promise = new Promise<InternalEventPayload>((resolve) => {
      const cb = (event: InternalEvent) => {
        if (event.replyId === eventToSend.id) {
          parentPort!.off('message', cb); // Unlisten, now that we're done
          resolve(event.payload); // Not type-safe but oh well
        }
      };
      parentPort!.on('message', cb);
    });

    // 3. Send the event after we start listening (to prevent race)
    sendEvent(eventToSend);

    // 4. Return the listener promise
    return promise as unknown as Promise<T>;
  }

  // Reload plugin if the JS or package.json changes
  const windowContextNone: WindowContext = { type: 'none' };
  const fileChangeCallback = async () => {
    await importModule();
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
  });

  let plug: PluginDefinition | null = null;

  function importModule() {
    const id = require.resolve(pathMod);
    delete require.cache[id];
    plug = require(id).plugin;
  }
  importModule();

  if (pkg.name?.includes('yaak-faker')) {
    sendPayload(
      { type: 'none' },
      { type: 'error_response', error: 'Failed to initialize Faker plugin' },
      null,
    );
    return;
  }

  // Message comes into the plugin to be processed
  parentPort!.on('message', async (event: InternalEvent) => {
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
          ...a,
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
        const reply: TemplateFunction[] = plug.templateFunctions.map((a) => ({
          ...a,
          // Add everything except render
          onRender: undefined,
        }));
        const replyPayload: InternalEventPayload = {
          type: 'get_template_functions_response',
          pluginRefId,
          functions: reply,
        };
        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'get_http_authentication_request' && plug?.authentication) {
        const { onApply: _, ...auth } = plug.authentication;
        const replyPayload: InternalEventPayload = {
          ...auth,
          type: 'get_http_authentication_response',
        };

        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'call_http_authentication_request' && plug?.authentication) {
        const auth = plug.authentication;
        if (typeof auth?.onApply === 'function') {
          const result = await auth.onApply(ctx, payload);
          sendPayload(
            windowContext,
            {
              ...result,
              type: 'call_http_authentication_response',
            },
            replyId,
          );
          return;
        }
      }

      if (
        payload.type === 'call_http_request_action_request' &&
        Array.isArray(plug?.httpRequestActions)
      ) {
        const action = plug.httpRequestActions.find((a) => a.key === payload.key);
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
        await importModule();
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
      // TODO: Return errors to server
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
