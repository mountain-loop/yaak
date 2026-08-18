/**
 * `ctx`, as a plugin sees it, built entirely out of one call to the host.
 *
 * Every method here serializes a request payload, hands it out of the sandbox,
 * and awaits a reply payload. That is the whole capability surface: the sandbox
 * has no socket, no clock it owns, no storage and no DOM, so anything a plugin
 * does to the world is a message the host chose to answer. The payload shapes
 * are the ones in `crates/yaak-plugins/src/events.rs`, unchanged, so a plugin
 * written for the Node runtime runs here without knowing which host it has.
 */

import type {
  CallPromptFormDynamicArgs,
  Context,
  DynamicPromptFormArg,
} from "@yaakapp/api";
import {
  applyDynamicFormInput,
  stripDynamicCallbacks,
} from "@yaakapp-internal/lib/pluginForms";
import { createResponseBody, decodeBase64Chunk } from "@yaakapp-internal/lib/responseBody";
import { applyFormInputDefaults } from "@yaakapp-internal/lib/templateFunction";
import type {
  DeleteKeyValueResponse,
  DeleteModelResponse,
  FindHttpResponsesResponse,
  Folder,
  FormInput,
  GetCookieValueRequest,
  GetCookieValueResponse,
  GetHttpRequestByIdResponse,
  GetHttpResponseBodyInfoResponse,
  GetKeyValueResponse,
  HttpRequest,
  HttpResponse,
  InternalEventPayload,
  ListCookieNamesResponse,
  ListFoldersResponse,
  ListHttpRequestsRequest,
  ListHttpRequestsResponse,
  ListOpenWorkspacesResponse,
  PluginContext,
  PromptFormResponse,
  PromptTextResponse,
  ReadHttpResponseBodyChunkResponse,
  RenderGrpcRequestResponse,
  RenderHttpRequestResponse,
  SendHttpRequestResponse,
  TemplateRenderRequest,
  TemplateRenderResponse,
  UpsertModelResponse,
  WindowInfoResponse,
} from "@yaakapp-internal/plugins";

/** What the host installs: one request out, one reply back. */
export type HostCall = (
  context: PluginContext,
  payload: InternalEventPayload,
) => Promise<Record<string, unknown>>;

/**
 * A response as a plugin should see it.
 *
 * `bodyPath` names a file on a host's disk. There is no disk here and there is
 * none in a browser, and plugins address bodies by response id, so it is
 * dropped rather than left for one to grow a dependency on.
 */
function forPlugin(httpResponse: HttpResponse): HttpResponse {
  const { bodyPath: _bodyPath, ...rest } = httpResponse as HttpResponse & {
    bodyPath?: string | null;
  };
  return rest;
}

export function newContext(call: HostCall, context: PluginContext): Context {
  const send = <T>(payload: InternalEventPayload): Promise<T> =>
    call(context, payload) as Promise<T>;

  /** Read a body the host has stored, a chunk at a time, following it if it is still arriving. */
  const storedBody = async (responseId: string) => {
    const bodyInfo = () =>
      send<GetHttpResponseBodyInfoResponse>({
        type: "get_http_response_body_info_request",
        responseId,
      });
    const info = await bodyInfo();

    return createResponseBody(
      {
        responseId,
        contentLength: info.contentLength,
        contentType: info.contentType ?? null,
        complete: info.complete,
      },
      async (offset, length) => {
        const chunk = await send<ReadHttpResponseBodyChunkResponse>({
          type: "read_http_response_body_chunk_request",
          responseId,
          offset,
          length,
        });
        return decodeBase64Chunk(chunk.data);
      },
      { refresh: bodyInfo },
    );
  };

  const windowInfo = async () => {
    if (context.label == null) {
      throw new Error("Can't get window context without an active window");
    }
    return send<WindowInfoResponse>({ type: "window_info_request", label: context.label });
  };

  const ctx: Context = {
    clipboard: {
      copyText: async (text) => {
        await send({ type: "copy_text_request", text });
      },
    },
    toast: {
      show: async (args) => {
        await send({
          type: "show_toast_request",
          // Defaulted here because null and undefined both become None in Rust.
          timeout: args.timeout === undefined ? 5000 : args.timeout,
          ...args,
        });
      },
    },
    window: {
      requestId: async () => (await windowInfo()).requestId,
      workspaceId: async () => (await windowInfo()).workspaceId,
      environmentId: async () => (await windowInfo()).environmentId,
      openUrl: async () => {
        // A window is the host's to open, and the browser host has one tab. A
        // plugin asking is told so rather than handed a handle that does
        // nothing when it calls `close()`.
        throw new Error("ctx.window.openUrl is not available in the sandbox runtime");
      },
      openExternalUrl: async (url) => {
        await send({ type: "open_external_url_request", url });
      },
    },
    prompt: {
      text: async (args) => {
        const reply = await send<PromptTextResponse>({ type: "prompt_text_request", ...args });
        return reply.value;
      },
      form: async (args) => {
        // The inputs a plugin declares may compute themselves from the values
        // entered so far. The host draws a static form, so they are resolved
        // against the defaults before it is drawn and the callbacks stripped
        // — a function cannot cross the boundary, and one left in would
        // serialize to nothing and take its input's shape with it.
        const defaults = applyFormInputDefaults(args.inputs, {});
        const callArgs: CallPromptFormDynamicArgs = { values: defaults };
        const resolved = await applyDynamicFormInput(
          ctx,
          args.inputs as DynamicPromptFormArg[],
          callArgs,
        );
        const reply = await send<PromptFormResponse>({
          type: "prompt_form_request",
          ...args,
          inputs: stripDynamicCallbacks(resolved) as FormInput[],
        });
        return reply.values;
      },
    },
    httpResponse: {
      find: async (args) => {
        const { httpResponses } = await send<FindHttpResponsesResponse>({
          type: "find_http_responses_request",
          ...args,
        });
        return httpResponses.map(forPlugin);
      },
      body: ({ responseId }) => storedBody(responseId),
    },
    grpcRequest: {
      render: async (args) => {
        const { grpcRequest } = await send<RenderGrpcRequestResponse>({
          type: "render_grpc_request_request",
          ...args,
        });
        return grpcRequest;
      },
    },
    httpRequest: {
      getById: async (args) => {
        const { httpRequest } = await send<GetHttpRequestByIdResponse>({
          type: "get_http_request_by_id_request",
          ...args,
        });
        return httpRequest;
      },
      send: async (args) => {
        const { httpResponse, body } = await send<SendHttpRequestResponse>({
          type: "send_http_request_request",
          ...args,
        });

        // A send with no request behind it saves nothing, so the reply carries
        // the only copy of its body. A saved one is read back from the host
        // like any other. Callers get the same thing either way.
        if (body == null) {
          return {
            httpResponse: forPlugin(httpResponse),
            body: await storedBody(httpResponse.id),
          };
        }

        const bytes = decodeBase64Chunk(body);
        return {
          httpResponse: forPlugin(httpResponse),
          body: createResponseBody(
            {
              responseId: httpResponse.id,
              contentLength: bytes.byteLength,
              contentType:
                httpResponse.headers.find((h) => h.name.toLowerCase() === "content-type")?.value ??
                null,
              // The host waited for the whole send before replying.
              complete: true,
            },
            async (offset, length) => bytes.slice(offset, offset + length),
          ),
        };
      },
      render: async (args) => {
        const { httpRequest } = await send<RenderHttpRequestResponse>({
          type: "render_http_request_request",
          ...args,
        });
        return httpRequest;
      },
      list: async (args?: { folderId?: string }) => {
        const payload: InternalEventPayload = {
          type: "list_http_requests_request",
          folderId: args?.folderId,
        } satisfies ListHttpRequestsRequest & { type: "list_http_requests_request" };
        const { httpRequests } = await send<ListHttpRequestsResponse>(payload);
        return httpRequests;
      },
      create: async (args) => {
        const response = await send<UpsertModelResponse>({
          type: "upsert_model_request",
          model: { name: "", method: "GET", ...args, id: "", model: "http_request" },
        } as InternalEventPayload);
        return response.model as HttpRequest;
      },
      update: async (args) => {
        const response = await send<UpsertModelResponse>({
          type: "upsert_model_request",
          model: { model: "http_request", ...args },
        } as InternalEventPayload);
        return response.model as HttpRequest;
      },
      delete: async (args) => {
        const response = await send<DeleteModelResponse>({
          type: "delete_model_request",
          model: "http_request",
          id: args.id,
        } as InternalEventPayload);
        return response.model as HttpRequest;
      },
    },
    folder: {
      list: async () => {
        const { folders } = await send<ListFoldersResponse>({ type: "list_folders_request" });
        return folders;
      },
      getById: async (args: { id: string }) => {
        const { folders } = await send<ListFoldersResponse>({ type: "list_folders_request" });
        return folders.find((f) => f.id === args.id) ?? null;
      },
      create: async ({ name, ...args }) => {
        const response = await send<UpsertModelResponse>({
          type: "upsert_model_request",
          model: { ...args, name: name ?? "", id: "", model: "folder" },
        } as InternalEventPayload);
        return response.model as Folder;
      },
      update: async (args) => {
        const response = await send<UpsertModelResponse>({
          type: "upsert_model_request",
          model: { model: "folder", ...args },
        } as InternalEventPayload);
        return response.model as Folder;
      },
      delete: async (args: { id: string }) => {
        const response = await send<DeleteModelResponse>({
          type: "delete_model_request",
          model: "folder",
          id: args.id,
        } as InternalEventPayload);
        return response.model as Folder;
      },
    },
    cookies: {
      getValue: async (args: GetCookieValueRequest) => {
        const { value } = await send<GetCookieValueResponse>({
          type: "get_cookie_value_request",
          ...args,
        });
        return value;
      },
      listNames: async () => {
        const { names } = await send<ListCookieNamesResponse>({ type: "list_cookie_names_request" });
        return names;
      },
    },
    templates: {
      render: async (args: TemplateRenderRequest) => {
        const result = await send<TemplateRenderResponse>({
          type: "template_render_request",
          ...args,
        });
        // oxlint-disable-next-line no-explicit-any -- the caller knows its own shape
        return result.data as any;
      },
    },
    store: {
      get: async <T>(key: string) => {
        const result = await send<GetKeyValueResponse>({ type: "get_key_value_request", key });
        return result.value ? (JSON.parse(result.value) as T) : undefined;
      },
      set: async <T>(key: string, value: T) => {
        await send<GetKeyValueResponse>({
          type: "set_key_value_request",
          key,
          value: JSON.stringify(value),
        });
      },
      delete: async (key: string) => {
        const result = await send<DeleteKeyValueResponse>({
          type: "delete_key_value_request",
          key,
        });
        return result.deleted;
      },
    },
    plugin: {
      reload: () => {
        void send({ type: "reload_response", silent: true });
      },
    },
    workspace: {
      list: async () => {
        const response = await send<ListOpenWorkspacesResponse>({
          type: "list_open_workspaces_request",
        });
        return response.workspaces.map((w) => {
          type WorkspaceInfoInternal = typeof w & { label?: string };
          return {
            id: w.id,
            name: w.name,
            // Kept for routing, hidden from plugin authors.
            _label: (w as WorkspaceInfoInternal).label as string,
          };
        });
      },
      withContext: (handle: { id: string; name: string; _label?: string }) =>
        newContext(call, { ...context, label: handle._label || null, workspaceId: handle.id }),
    },
  };

  return ctx;
}
