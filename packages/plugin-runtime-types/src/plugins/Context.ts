import type {
  FindHttpResponsesRequest,
  FindHttpResponsesResponse,
  FormInput,
  GetCookieValueRequest,
  GetCookieValueResponse,
  GetHttpRequestByIdRequest,
  GetHttpRequestByIdResponse,
  GetHttpResponseBodyInfoRequest,
  JsonPrimitive,
  ListCookieNamesResponse,
  ListFoldersRequest,
  ListFoldersResponse,
  ListHttpRequestsRequest,
  ListHttpRequestsResponse,
  OpenWindowRequest,
  PromptFormRequest,
  PromptFormResponse,
  PromptTextRequest,
  PromptTextResponse,
  RenderGrpcRequestRequest,
  RenderGrpcRequestResponse,
  RenderHttpRequestRequest,
  RenderHttpRequestResponse,
  SendHttpRequestRequest,
  ShowToastRequest,
  TemplateRenderRequest,
  WorkspaceInfo,
} from "../bindings/gen_events.ts";
import type { Folder, HttpRequest, HttpResponse } from "../bindings/gen_models.ts";
import type { JsonValue } from "../bindings/serde_json/JsonValue";
import type { MaybePromise } from "../helpers";

export type CallPromptFormDynamicArgs = {
  values: { [key in string]?: JsonPrimitive };
};

type AddDynamicMethod<T> = {
  dynamic?: (
    ctx: Context,
    args: CallPromptFormDynamicArgs,
  ) => MaybePromise<Partial<T> | null | undefined>;
};

// oxlint-disable-next-line no-explicit-any -- distributive conditional type pattern
type AddDynamic<T> = T extends any
  ? T extends { inputs?: FormInput[] }
    ? Omit<T, "inputs"> & {
        inputs: Array<AddDynamic<FormInput>>;
        dynamic?: (
          ctx: Context,
          args: CallPromptFormDynamicArgs,
        ) => MaybePromise<
          Partial<Omit<T, "inputs"> & { inputs: Array<AddDynamic<FormInput>> }> | null | undefined
        >;
      }
    : T & AddDynamicMethod<T>
  : never;

export type DynamicPromptFormArg = AddDynamic<FormInput>;

type DynamicPromptFormRequest = Omit<PromptFormRequest, "inputs"> & {
  inputs: DynamicPromptFormArg[];
};

export type WorkspaceHandle = Pick<WorkspaceInfo, "id" | "name">;

export interface ReadHttpResponseBodyOptions {
  /**
   * Refuse to buffer a body larger than this, in bytes. Defaults to 32 MiB.
   * Pass `Infinity` to read whatever is there.
   */
  maxBytes?: number;

  /** Bytes to pull from the host at a time. Defaults to 1 MiB. */
  chunkSize?: number;
}

/**
 * A response body, read back from wherever the host stored it.
 *
 * The accessors are named after `fetch`'s and behave the same way against a
 * response that is still arriving: they wait for the rest, and one that never
 * finishes is never finished reading — `chunks()` is the way to consume that.
 * Unlike `fetch`, the body is not used up by reading it: the bytes are in
 * durable storage, so every accessor can be called as many times as you like,
 * in any order.
 */
export interface HttpResponseBody {
  /** The response these bytes belong to. */
  readonly responseId: string;

  /**
   * How many bytes were stored when this body was opened, which is not
   * necessarily what the `Content-Length` header claimed. Zero when the
   * response has no body. Final only if `complete`.
   */
  readonly contentLength: number;

  /** The response's `Content-Type` header, verbatim, or null if it had none. */
  readonly contentType: string | null;

  /**
   * Whether the response had finished arriving when this body was opened.
   * When false, the accessors below will wait for the rest of it.
   */
  readonly complete: boolean;

  /**
   * The whole body decoded to a string, using the charset from `contentType`
   * and falling back to UTF-8. Waits for a response still arriving. Throws
   * once more than `maxBytes` has been read.
   */
  text(options?: ReadHttpResponseBodyOptions): Promise<string>;

  /** `text()`, parsed as JSON. */
  json<T = unknown>(options?: ReadHttpResponseBodyOptions): Promise<T>;

  /** The whole body as raw bytes. Waits and throws as `text()` does. */
  arrayBuffer(options?: ReadHttpResponseBodyOptions): Promise<ArrayBuffer>;

  /**
   * The raw bytes, a chunk at a time, so a body of any size can be read
   * without holding all of it at once. Not subject to `maxBytes`.
   *
   * Follows a response that is still arriving, yielding as it comes, and ends
   * when the response does. Break out of the loop to stop early.
   */
  chunks(options?: Pick<ReadHttpResponseBodyOptions, "chunkSize">): AsyncIterable<Uint8Array>;
}

/** What a send came back with. */
export interface SentHttpRequest {
  httpResponse: HttpResponse;

  /**
   * The response's body.
   *
   * Handed over here rather than looked up later, because a request with no id
   * is not saved and this is the only copy of its body. Reading it is the same
   * either way, so nothing has to know which kind of send it made.
   */
  body: HttpResponseBody;
}

export interface Context {
  clipboard: {
    copyText(text: string): Promise<void>;
  };
  toast: {
    show(args: ShowToastRequest): Promise<void>;
  };
  prompt: {
    text(args: PromptTextRequest): Promise<PromptTextResponse["value"]>;
    form(args: DynamicPromptFormRequest): Promise<PromptFormResponse["values"]>;
  };
  store: {
    set<T>(key: string, value: T): Promise<void>;
    get<T>(key: string): Promise<T | undefined>;
    delete(key: string): Promise<boolean>;
  };
  window: {
    requestId(): Promise<string | null>;
    workspaceId(): Promise<string | null>;
    environmentId(): Promise<string | null>;
    openUrl(
      args: OpenWindowRequest & {
        onNavigate?: (args: { url: string }) => void;
        onClose?: () => void;
      },
    ): Promise<{ close: () => void }>;
    openExternalUrl(url: string): Promise<void>;
  };
  cookies: {
    listNames(): Promise<ListCookieNamesResponse["names"]>;
    getValue(args: GetCookieValueRequest): Promise<GetCookieValueResponse["value"]>;
  };
  grpcRequest: {
    render(args: RenderGrpcRequestRequest): Promise<RenderGrpcRequestResponse["grpcRequest"]>;
  };
  httpRequest: {
    /**
     * Send a request and wait for the response and its body.
     *
     * The body comes back with the response because a request with no id is
     * never saved, and there would be nothing to look up afterwards.
     */
    send(args: SendHttpRequestRequest): Promise<SentHttpRequest>;
    getById(args: GetHttpRequestByIdRequest): Promise<GetHttpRequestByIdResponse["httpRequest"]>;
    render(args: RenderHttpRequestRequest): Promise<RenderHttpRequestResponse["httpRequest"]>;
    list(args?: ListHttpRequestsRequest): Promise<ListHttpRequestsResponse["httpRequests"]>;
    create(
      args: Omit<Partial<HttpRequest>, "id" | "model" | "createdAt" | "updatedAt"> &
        Pick<HttpRequest, "workspaceId" | "url">,
    ): Promise<HttpRequest>;
    update(
      args: Omit<Partial<HttpRequest>, "model" | "createdAt" | "updatedAt"> &
        Pick<HttpRequest, "id">,
    ): Promise<HttpRequest>;
    delete(args: { id: string }): Promise<HttpRequest>;
  };
  folder: {
    list(args?: ListFoldersRequest): Promise<ListFoldersResponse["folders"]>;
    getById(args: { id: string }): Promise<Folder | null>;
    create(
      args: Omit<Partial<Folder>, "id" | "model" | "createdAt" | "updatedAt"> &
        Pick<Folder, "workspaceId" | "name">,
    ): Promise<Folder>;
    update(
      args: Omit<Partial<Folder>, "model" | "createdAt" | "updatedAt"> & Pick<Folder, "id">,
    ): Promise<Folder>;
    delete(args: { id: string }): Promise<Folder>;
  };
  httpResponse: {
    find(args: FindHttpResponsesRequest): Promise<FindHttpResponsesResponse["httpResponses"]>;
    /**
     * Read a saved response's body by id. Where the host keeps the bytes —
     * files on a desktop, rows in a database, somewhere else later — is not
     * something a plugin sees or should depend on.
     *
     * Ids come from `find`. A response that was never saved has none to look
     * up, so its body arrives with the send that made it instead.
     */
    body(args: GetHttpResponseBodyInfoRequest): Promise<HttpResponseBody>;
  };
  templates: {
    render<T extends JsonValue>(args: TemplateRenderRequest & { data: T }): Promise<T>;
  };
  plugin: {
    reload(): void;
  };
  workspace: {
    list(): Promise<WorkspaceHandle[]>;
    withContext(handle: WorkspaceHandle): Context;
  };
}
