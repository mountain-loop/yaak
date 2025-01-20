import type {
  FindHttpResponsesRequest,
  FindHttpResponsesResponse,
  GetHttpRequestByIdRequest,
  GetHttpRequestByIdResponse,
  PromptTextRequest,
  PromptTextResponse,
  RenderHttpRequestRequest,
  RenderHttpRequestResponse,
  SendHttpRequestRequest,
  SendHttpRequestResponse,
  ShowToastRequest,
  TemplateRenderRequest,
  TemplateRenderResponse,
} from "../bindings/events.ts";

export interface Context {
  clipboard: {
    copyText(text: string): Promise<void>;
  };
  toast: {
    show(args: ShowToastRequest): Promise<void>;
  };
  prompt: {
    text(args: PromptTextRequest): Promise<PromptTextResponse["value"]>;
  };
  httpRequest: {
    send(
      args: SendHttpRequestRequest,
    ): Promise<SendHttpRequestResponse["httpResponse"]>;
    getById(
      args: GetHttpRequestByIdRequest,
    ): Promise<GetHttpRequestByIdResponse["httpRequest"]>;
    render(
      args: RenderHttpRequestRequest,
    ): Promise<RenderHttpRequestResponse["httpRequest"]>;
  };
  httpResponse: {
    find(
      args: FindHttpResponsesRequest,
    ): Promise<FindHttpResponsesResponse["httpResponses"]>;
  };
  templates: {
    render(
      args: TemplateRenderRequest,
    ): Promise<TemplateRenderResponse["data"]>;
  };
}
