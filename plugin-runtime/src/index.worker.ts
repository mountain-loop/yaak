import {
  BootRequest,
  FindHttpResponsesResponse,
  GetHttpRequestByIdResponse,
  HttpRequestAction,
  ImportResponse,
  InternalEvent,
  InternalEventPayload,
  PromptTextResponse,
  RenderHttpRequestResponse,
  SendHttpRequestResponse,
  TemplateFunction,
  TemplateRenderResponse,
  WindowContext,
} from '@yaakapp-internal/plugins';
import { Context } from '@yaakapp/api';
import { HttpRequestActionPlugin } from '@yaakapp/api/lib/plugins/HttpRequestActionPlugin';
import { TemplateFunctionPlugin } from '@yaakapp/api/lib/plugins/TemplateFunctionPlugin';
import interceptStdout from 'intercept-stdout';
import * as console from 'node:console';
import { readFileSync, Stats, statSync, watch } from 'node:fs';
import path from 'node:path';
import * as util from 'node:util';
import { parentPort, workerData } from 'node:worker_threads';

export interface PluginWorkerData {
  bootRequest: BootRequest;
  pluginRefId: string;
}

async function initialize() {
  const {
    bootRequest: { dir: pluginDir, watch: enableWatch },
    pluginRefId,
  }: PluginWorkerData = workerData;
  const pathPkg = path.join(pluginDir, 'package.json');

  const pathMod = path.posix.join(pluginDir, 'build', 'index.js');

  async function importModule() {
    const id = require.resolve(pathMod);
    delete require.cache[id];
    return require(id);
  }

  const pkg = JSON.parse(readFileSync(pathPkg, 'utf8'));

  prefixStdout(`[plugin][${pkg.name}] %s`);

  let mod = await importModule();

  const capabilities: string[] = [];
  if (typeof mod.pluginHookExport === 'function') capabilities.push('export');
  if (typeof mod.pluginHookImport === 'function') capabilities.push('import');
  if (typeof mod.pluginHookResponseFilter === 'function') capabilities.push('filter');

  console.log('Plugin initialized', pkg.name, { capabilities, enableWatch });

  function buildEventToSend(
    windowContext: WindowContext,
    payload: InternalEventPayload,
    replyId: string | null = null,
  ): InternalEvent {
    return { pluginRefId, id: genId(), replyId, payload, windowContext };
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

  async function sendAndWaitForReply<T extends Omit<InternalEventPayload, 'type'>>(
    windowContext: WindowContext,
    payload: InternalEventPayload,
  ): Promise<T> {
    // 1. Build event to send
    const eventToSend = buildEventToSend(windowContext, payload, null);

    // 2. Spawn listener in background
    const promise = new Promise<InternalEventPayload>(async (resolve) => {
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

  async function reloadModule() {
    mod = await importModule();
  }

  // Reload plugin if JS or package.json changes
  const windowContextNone: WindowContext = { type: 'none' };
  const cb = async () => {
    await reloadModule();
    return sendPayload(windowContextNone, { type: 'reload_response' }, null);
  };

  if (enableWatch) {
    watchFile(pathMod, cb);
    watchFile(pathPkg, cb);
  }

  const newCtx = (event: InternalEvent): Context => ({
    clipboard: {
      async copyText(text) {
        await sendAndWaitForReply(event.windowContext, { type: 'copy_text_request', text });
      },
    },
    toast: {
      async show(args) {
        await sendAndWaitForReply(event.windowContext, { type: 'show_toast_request', ...args });
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
        const payload = { type: 'find_http_responses_request', ...args } as const;
        const { httpResponses } = await sendAndWaitForReply<FindHttpResponsesResponse>(
          event.windowContext,
          payload,
        );
        return httpResponses;
      },
    },
    httpRequest: {
      async getById(args) {
        const payload = { type: 'get_http_request_by_id_request', ...args } as const;
        const { httpRequest } = await sendAndWaitForReply<GetHttpRequestByIdResponse>(
          event.windowContext,
          payload,
        );
        return httpRequest;
      },
      async send(args) {
        const payload = { type: 'send_http_request_request', ...args } as const;
        const { httpResponse } = await sendAndWaitForReply<SendHttpRequestResponse>(
          event.windowContext,
          payload,
        );
        return httpResponse;
      },
      async render(args) {
        const payload = { type: 'render_http_request_request', ...args } as const;
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
       * */
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

  // Message comes into the plugin to be processed
  parentPort!.on('message', async (event: InternalEvent) => {
    let { windowContext, payload, id: replyId } = event;
    const ctx = newCtx(event);
    try {
      if (payload.type === 'boot_request') {
        const payload: InternalEventPayload = {
          type: 'boot_response',
          name: pkg.name,
          version: pkg.version,
          capabilities,
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

      if (payload.type === 'import_request' && typeof mod.pluginHookImport === 'function') {
        const reply: ImportResponse | null = await mod.pluginHookImport(ctx, payload.content);
        if (reply != null) {
          const replyPayload: InternalEventPayload = {
            type: 'import_response',
            resources: reply?.resources,
          };
          sendPayload(windowContext, replyPayload, replyId);
          return;
        } else {
          // Continue, to send back an empty reply
        }
      }

      if (
        payload.type === 'export_http_request_request' &&
        typeof mod.pluginHookExport === 'function'
      ) {
        const reply: string = await mod.pluginHookExport(ctx, payload.httpRequest);
        const replyPayload: InternalEventPayload = {
          type: 'export_http_request_response',
          content: reply,
        };
        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (payload.type === 'filter_request' && typeof mod.pluginHookResponseFilter === 'function') {
        const reply: string = await mod.pluginHookResponseFilter(ctx, {
          filter: payload.filter,
          body: payload.content,
        });
        const replyPayload: InternalEventPayload = {
          type: 'filter_response',
          content: reply,
        };
        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'get_http_request_actions_request' &&
        Array.isArray(mod.plugin?.httpRequestActions)
      ) {
        const reply: HttpRequestAction[] = mod.plugin.httpRequestActions.map(
          (a: HttpRequestActionPlugin) => ({
            ...a,
            // Add everything except onSelect
            onSelect: undefined,
          }),
        );
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
        Array.isArray(mod.plugin?.templateFunctions)
      ) {
        const reply: TemplateFunction[] = mod.plugin.templateFunctions.map(
          (a: TemplateFunctionPlugin) => ({
            ...a,
            // Add everything except render
            onRender: undefined,
          }),
        );
        const replyPayload: InternalEventPayload = {
          type: 'get_template_functions_response',
          pluginRefId,
          functions: reply,
        };
        sendPayload(windowContext, replyPayload, replyId);
        return;
      }

      if (
        payload.type === 'call_http_request_action_request' &&
        Array.isArray(mod.plugin?.httpRequestActions)
      ) {
        const action = mod.plugin.httpRequestActions.find(
          (a: HttpRequestActionPlugin) => a.key === payload.key,
        );
        if (typeof action?.onSelect === 'function') {
          await action.onSelect(ctx, payload.args);
          sendEmpty(windowContext, replyId);
          return;
        }
      }

      if (
        payload.type === 'call_template_function_request' &&
        Array.isArray(mod.plugin?.templateFunctions)
      ) {
        const action = mod.plugin.templateFunctions.find(
          (a: TemplateFunctionPlugin) => a.name === payload.name,
        );
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
        await reloadModule();
      }
    } catch (err) {
      console.log('Plugin call threw exception', payload.type, err);
      // TODO: Return errors to server
    }

    // No matches, so send back an empty response so the caller doesn't block forever
    sendEmpty(windowContext, replyId);
  });
}

initialize().catch((err) => {
  console.log('failed to boot plugin', err);
});

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
  interceptStdout((text) => {
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
 * We also track the stat for each file because fs.watch will
 * trigger a "change" event when the access date changes
 */
function watchFile(filepath: string, cb: (filepath: string) => void) {
  watch(filepath, (_event, _name) => {
    const stat = statSync(filepath);
    if (stat.mtimeMs !== watchedFiles[filepath]?.mtimeMs) {
      cb(filepath);
    }
    watchedFiles[filepath] = stat;
  });
}
