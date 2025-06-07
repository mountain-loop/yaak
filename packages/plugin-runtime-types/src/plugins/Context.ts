import type {
  FindHttpResponsesRequest,
  FindHttpResponsesResponse,
  GetCookieValueRequest,
  GetCookieValueResponse,
  GetHttpRequestByIdRequest,
  GetHttpRequestByIdResponse,
  ListCookieNamesResponse,
  OpenWindowRequest,
  PromptTextRequest,
  PromptTextResponse,
  RenderHttpRequestRequest,
  RenderHttpRequestResponse,
  SendHttpRequestRequest,
  SendHttpRequestResponse,
  ShowToastRequest,
  TemplateRenderRequest,
  TemplateRenderResponse,
} from '../bindings/gen_events.ts';

export interface Context {
  clipboard: {
    copyText(text: string): Promise<void>;
  };
  toast: {
    show(args: ShowToastRequest): Promise<void>;
  };
  prompt: {
    text(args: PromptTextRequest): Promise<PromptTextResponse['value']>;
  };
  store: {
    set<T>(key: string, value: T): Promise<void>;
    get<T>(key: string): Promise<T | undefined>;
    delete(key: string): Promise<boolean>;
  };
  window: {
    openUrl(
      args: OpenWindowRequest & {
        onNavigate?: (args: { url: string }) => void;
        onClose?: () => void;
      },
    ): Promise<{ close: () => void }>;
  };
  cookies: {
    listNames(): Promise<ListCookieNamesResponse['names']>;
    getValue(args: GetCookieValueRequest): Promise<GetCookieValueResponse['value']>;
  };
  httpRequest: {
    send(args: SendHttpRequestRequest): Promise<SendHttpRequestResponse['httpResponse']>;
    getById(args: GetHttpRequestByIdRequest): Promise<GetHttpRequestByIdResponse['httpRequest']>;
    render(args: RenderHttpRequestRequest): Promise<RenderHttpRequestResponse['httpRequest']>;
  };
  httpResponse: {
    find(args: FindHttpResponsesRequest): Promise<FindHttpResponsesResponse['httpResponses']>;
  };
  templates: {
    render(args: TemplateRenderRequest): Promise<TemplateRenderResponse['data']>;
  };
}
