import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { ComponentType } from "react";
import { languageFromContentType } from "../../lib/contentType";
import { getMimeTypeFromContentType } from "../../lib/mimeType";
import { Banner } from "../Banner";
import { Button } from "../Button";
import { EmptyStateText } from "../EmptyStateText";
import { type EditorHost, useEditorHost } from "../EditorHost";
import { LoadingIcon } from "../LoadingIcon";
import { HStack, VStack } from "../Stacks";
import { AudioViewer } from "../viewers/AudioViewer";
import { CsvViewer } from "../viewers/CsvViewer";
import { ImageViewer } from "../viewers/ImageViewer";
import { SvgViewer } from "../viewers/SvgViewer";
import type { TextViewerProps } from "../viewers/TextViewer";
import { VideoViewer } from "../viewers/VideoViewer";
import { WebPageViewer } from "../viewers/WebPageViewer";
import type { HttpBodyLoader, HttpResponseView } from "./types";

export type ResponseViewMode = "pretty" | "raw";

/** What the text viewer adds for the app, like its filter history and save and copy buttons */
export type ResponseTextViewerExtras = Pick<
  TextViewerProps,
  "footerActions" | "filterStateKey" | "onFilterApplied" | "filterLeftSlot"
>;

interface Props {
  response: HttpResponseView;
  body: HttpBodyLoader;
  viewMode: ResponseViewMode;
  textViewer?: ResponseTextViewerExtras;
  /** Stop a request that's still being sent */
  onCancel?: () => void;
  /** Viewers only this pane's app has, tried before the host's and the shared ones */
  renderBodyViewer?: EditorHost["renderBodyViewer"];
}

/** Picks the viewer for a response body from its content type, as the client's response pane does */
export function ResponseBodyViewer({
  response,
  body,
  viewMode,
  textViewer,
  onCancel,
  renderBodyViewer: renderPaneBodyViewer,
}: Props) {
  const { renderBodyViewer: renderHostBodyViewer } = useEditorHost();
  const mimeType =
    response.contentType == null ? null : getMimeTypeFromContentType(response.contentType).essence;

  if (response.state === "initialized") {
    return (
      <EmptyStateText>
        <VStack space={3}>
          <HStack space={3}>
            <LoadingIcon className="text-text-subtlest" />
            Sending Request
          </HStack>
          {onCancel != null && (
            <Button size="sm" variant="border" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </VStack>
      </EmptyStateText>
    );
  }

  if (response.state === "closed" && (response.contentLength ?? 0) === 0) {
    return <EmptyStateText>Empty</EmptyStateText>;
  }

  const viewerArgs = {
    source: "response" as const,
    mimeType,
    viewMode,
    body,
    complete: response.state === "closed",
  };
  const appViewer = renderPaneBodyViewer?.(viewerArgs) ?? renderHostBodyViewer?.(viewerArgs);
  if (appViewer != null) return appViewer;

  if (mimeType?.match(/^image\/svg/)) {
    return <BodySvgViewer body={body} />;
  }
  if (mimeType?.match(/^image/i)) {
    return <EnsureCompleteResponse response={response} body={body} Component={ImageViewer} />;
  }
  if (mimeType?.match(/^audio/i)) {
    return <EnsureCompleteResponse response={response} body={body} Component={AudioViewer} />;
  }
  if (mimeType?.match(/^video/i)) {
    return <EnsureCompleteResponse response={response} body={body} Component={VideoViewer} />;
  }
  if (mimeType?.match(/^multipart/i) && viewMode === "pretty") {
    return <BodyMultipartViewer response={response} body={body} />;
  }
  if (mimeType?.match(/csv|tab-separated/i) && viewMode === "pretty") {
    return <BodyCsvViewer className="pb-2" body={body} />;
  }
  return (
    <HTMLOrTextViewer
      textViewerClassName="-mr-2 bg-surface" // Pull to the right
      response={response}
      body={body}
      pretty={viewMode === "pretty"}
      textViewer={textViewer}
    />
  );
}

/** A body with no text is either empty or not valid UTF-8, which only its bytes can tell apart */
function BinaryOrEmptyBody({ body }: { body: HttpBodyLoader }) {
  const bytes = body.useBytes();
  if (bytes.isLoading) return null;
  const length = bytes.data?.length ?? 0;
  return (
    <EmptyStateText>
      {length > 0 ? `Binary body, ${formatSize(length)}` : "Empty response"}
    </EmptyStateText>
  );
}

function EnsureCompleteResponse({
  response,
  body,
  Component,
}: {
  response: HttpResponseView;
  body: HttpBodyLoader;
  Component: ComponentType<{ bodyUrl: string }>;
}) {
  // Wait until the response has been fully-downloaded before asking for it
  const complete = response.state === "closed";
  const bodyUrl = body.useUrl(complete);

  if (!complete || bodyUrl.isLoading) {
    return (
      <EmptyStateText>
        <LoadingIcon />
      </EmptyStateText>
    );
  }

  if (bodyUrl.error) {
    return <Banner color="danger">{String(bodyUrl.error)}</Banner>;
  }

  if (bodyUrl.data == null) {
    return <div>Empty response body</div>;
  }

  return <Component bodyUrl={bodyUrl.data} />;
}

function BodySvgViewer({ body }: { body: HttpBodyLoader }) {
  const text = body.useText();
  if (!text.data) return null;
  return <SvgViewer text={text.data} />;
}

function BodyCsvViewer({ body, className }: { body: HttpBodyLoader; className?: string }) {
  const text = body.useText();
  return <CsvViewer text={text.data ?? null} className={className} />;
}

function BodyMultipartViewer({
  response,
  body,
}: {
  response: HttpResponseView;
  body: HttpBodyLoader;
}) {
  const { MultipartViewer } = useEditorHost();
  const bytes = body.useBytes();
  if (bytes.data == null) return null;

  const boundary = response.contentType?.split("boundary=")[1] ?? "unknown";
  return <MultipartViewer data={bytes.data} boundary={boundary} idPrefix={response.id} />;
}

interface HTMLOrTextViewerProps {
  response: HttpResponseView;
  body: HttpBodyLoader;
  pretty: boolean;
  textViewerClassName?: string;
  textViewer?: ResponseTextViewerExtras;
}

export function HTMLOrTextViewer({
  response,
  body,
  pretty,
  textViewerClassName,
  textViewer,
}: HTMLOrTextViewerProps) {
  const { TextViewer } = useEditorHost();
  const rawTextBody = body.useText();
  const language = languageFromContentType(response.contentType, rawTextBody.data ?? "");

  if (rawTextBody.isLoading || response.state === "initialized") {
    return null;
  }

  if (language === "html" && pretty) {
    return <WebPageViewer html={rawTextBody.data ?? ""} baseUrl={response.url} />;
  }
  if (rawTextBody.data == null) {
    return <BinaryOrEmptyBody body={body} />;
  }
  return (
    <TextViewer
      text={rawTextBody.data}
      language={language}
      stateKey={`response.body.${response.id}`}
      pretty={pretty}
      className={textViewerClassName}
      filterText={body.filterText}
      filterStateKey={`response.body.${response.ownerId}`}
      {...textViewer}
    />
  );
}
