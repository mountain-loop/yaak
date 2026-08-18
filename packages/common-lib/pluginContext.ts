/**
 * `ctx`, built once for every runtime that has one. A runtime supplies only how
 * a payload reaches its host.
 *
 * `stream` and `form` are optional because they are the two places a host
 * genuinely differs: both need a conversation rather than one reply.
 */

import type {
  CallPromptFormDynamicArgs,
  Context,
  DynamicPromptFormArg,
} from "@yaakapp/api";
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
import { applyDynamicFormInput, stripDynamicCallbacks } from "./pluginForms";
import { createResponseBody, decodeBase64Chunk } from "./responseBody";
import { applyFormInputDefaults } from "./templateFunction";

export interface PluginTransport {
  request(
    context: PluginContext,
    payload: InternalEventPayload,
  ): Promise<Record<string, unknown>>;

  notify(context: PluginContext, payload: InternalEventPayload): void;

  /** Send once, keep receiving. Windows report navigation until they close. */
  stream?(
    context: PluginContext,
    payload: InternalEventPayload,
    onReply: (payload: InternalEventPayload) => void,
  ): void;

  /**
   * A form that may re-render before it settles: `onChange` answers with the
   * form to show next. Without it, a form is drawn once from its defaults.
   */
  form?(
    context: PluginContext,
    payload: InternalEventPayload,
    onChange: (
      values: Record<string, unknown>,
    ) => Promise<InternalEventPayload | null>,
  ): Promise<PromptFormResponse>;
}

/** `bodyPath` names a file on a host's disk; plugins address bodies by id. */
function forPlugin(httpResponse: HttpResponse): HttpResponse {
  const { bodyPath: _bodyPath, ...rest } = httpResponse as HttpResponse & {
    bodyPath?: string | null;
  };
  return rest;
}

export function createPluginContext(
  transport: PluginTransport,
  context: PluginContext,
): Context {
  const send = <T>(payload: InternalEventPayload): Promise<T> =>
    transport.request(context, payload) as Promise<T>;

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
      openUrl: async ({ onNavigate, onClose, ...args }) => {
        if (transport.stream == null) {
          throw new Error("ctx.window.openUrl is not available in this runtime");
        }
        args.label = args.label || `${Math.random()}`;
        transport.stream(context, { type: "open_window_request", ...args }, (event) => {
          if (event.type === "window_navigate_event") onNavigate?.(event);
          else if (event.type === "window_close_event") onClose?.();
        });
        return {
          close: () => {
            transport.notify(context, { type: "close_window_request", label: args.label });
          },
        };
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
        // Inputs may compute from the values entered so far, and a function
        // cannot cross to a host.
        const resolve = async (values: Record<string, unknown>) => {
          const callArgs: CallPromptFormDynamicArgs = { values } as CallPromptFormDynamicArgs;
          const resolved = await applyDynamicFormInput(
            ctx,
            args.inputs as DynamicPromptFormArg[],
            callArgs,
          );
          return stripDynamicCallbacks(resolved) as FormInput[];
        };

        const initial = await resolve(applyFormInputDefaults(args.inputs, {}));
        const payload: InternalEventPayload = {
          type: "prompt_form_request",
          ...args,
          inputs: initial,
        };

        if (transport.form == null) {
          const reply = await send<PromptFormResponse>(payload);
          return reply.values;
        }

        const reply = await transport.form(context, payload, async (values) => {
          // Fired on mount, before there is anything to recompute from.
          if (values == null || Object.keys(values).length === 0) return null;
          return { type: "prompt_form_request", ...args, inputs: await resolve(values) };
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
        // the only copy of its body.
        if (body == null) {
          return { httpResponse: forPlugin(httpResponse), body: await storedBody(httpResponse.id) };
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
        transport.notify(context, { type: "reload_response", silent: true });
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
        createPluginContext(transport, {
          ...context,
          label: handle._label || null,
          workspaceId: handle.id,
        }),
    },
  };

  return ctx;
}
