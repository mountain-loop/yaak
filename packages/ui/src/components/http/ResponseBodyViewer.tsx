import type { HttpResponse } from "@yaakapp-internal/models";
import { useQueryClient } from "@tanstack/react-query";
import { languageFromContentType, type TextFilterApi, WebPageViewer } from "@yaakapp-internal/ui";
import type { CodeEditorProps } from "@yaakapp-internal/ui/editor";
import { useCallback } from "react";
import { useCopyHttpResponse } from "../../hooks/useCopyHttpResponse";
import { useRecentFilters } from "../../hooks/useRecentFilters";
import { responseBodyTextQuery, useResponseBodyText } from "../../hooks/useResponseBodyText";
import { useSaveResponse } from "../../hooks/useSaveResponse";
import { getContentTypeFromHeaders } from "../../lib/model_util";
import { IconButton } from "../core/IconButton";
import { EmptyStateText } from "../EmptyStateText";
import { RecentFiltersDropdown } from "./RecentFiltersDropdown";
import { TextViewer } from "./TextViewer";

interface Props {
  response: HttpResponse;
  pretty: boolean;
  textViewerClassName?: string;
}

export function HTMLOrTextViewer({ response, pretty, textViewerClassName }: Props) {
  const rawTextBody = useResponseBodyText({ response, filter: null });
  const contentType = getContentTypeFromHeaders(response.headers);
  const language = languageFromContentType(contentType, rawTextBody.data ?? "");

  if (rawTextBody.isLoading || response.state === "initialized") {
    return null;
  }

  if (language === "html" && pretty) {
    return <WebPageViewer html={rawTextBody.data ?? ""} baseUrl={response.url} />;
  }
  if (rawTextBody.data == null) {
    return <EmptyStateText>Empty response</EmptyStateText>;
  }
  return (
    <HttpTextViewer
      response={response}
      text={rawTextBody.data}
      language={language}
      pretty={pretty}
      className={textViewerClassName}
    />
  );
}

interface HttpTextViewerProps {
  response: HttpResponse;
  text: string;
  language: CodeEditorProps["language"];
  pretty: boolean;
  className?: string;
}

function HttpTextViewer({ response, text, language, pretty, className }: HttpTextViewerProps) {
  const queryClient = useQueryClient();
  const filterStateKey = `response.body.${response.requestId}`;
  // Shares the response body query's cache, so applying and showing a filter cost one RPC
  const filterText = useCallback(
    (f: string) => queryClient.fetchQuery(responseBodyTextQuery({ response, filter: f })),
    [queryClient, response],
  );
  const { recentFilters, addFilter, removeFilter, togglePin, clearFilters } =
    useRecentFilters(filterStateKey);
  const filterLeftSlot = useCallback(
    (filter: TextFilterApi) => (
      <div className="py-0.5 flex">
        <RecentFiltersDropdown
          recentFilters={recentFilters}
          activeFilter={filter.appliedFilter}
          onSelect={filter.replaceFilter}
          onRemove={removeFilter}
          onTogglePin={togglePin}
          onClear={clearFilters}
        />
      </div>
    ),
    [recentFilters, removeFilter, togglePin, clearFilters],
  );
  const saveResponse = useSaveResponse(response);
  const copyResponse = useCopyHttpResponse(response);
  const actionsDisabled = response.state !== "closed" && response.status >= 100;

  return (
    <TextViewer
      text={text}
      language={language}
      stateKey={`response.body.${response.id}`}
      pretty={pretty}
      className={className}
      footerActions={[
        <IconButton
          key="save"
          size="sm"
          icon="save"
          title="Save response to file"
          disabled={actionsDisabled}
          onClick={() => saveResponse.mutate()}
          className="border !border-border-subtle"
        />,
        <IconButton
          key="copy"
          size="sm"
          icon="copy"
          title="Copy response body"
          disabled={actionsDisabled}
          onClick={() => copyResponse.mutate()}
          className="border !border-border-subtle"
        />,
      ]}
      filterText={filterText}
      filterStateKey={filterStateKey}
      onFilterApplied={addFilter}
      filterLeftSlot={filterLeftSlot}
    />
  );
}
