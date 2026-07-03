import type { HttpResponse } from "@yaakapp-internal/models";
import { useMemo, useState } from "react";
import { useCopyHttpResponse } from "../../hooks/useCopyHttpResponse";
import { useResponseBodyText } from "../../hooks/useResponseBodyText";
import { useSaveResponse } from "../../hooks/useSaveResponse";
import { languageFromContentType } from "../../lib/contentType";
import { getContentTypeFromHeaders } from "../../lib/model_util";
import type { EditorProps } from "../core/Editor/Editor";
import { IconButton } from "../core/IconButton";
import { EmptyStateText } from "../EmptyStateText";
import { TextViewer } from "./TextViewer";
import { WebPageViewer } from "./WebPageViewer";

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
  language: EditorProps["language"];
  pretty: boolean;
  className?: string;
}

function HttpTextViewer({ response, text, language, pretty, className }: HttpTextViewerProps) {
  const [currentFilter, setCurrentFilter] = useState<string | null>(null);
  const filteredBody = useResponseBodyText({ response, filter: currentFilter });
  const saveResponse = useSaveResponse(response);
  const copyResponse = useCopyHttpResponse(response);
  const actionsDisabled = response.state !== "closed" && response.status >= 100;

  const filterCallback = useMemo(
    () => (filter: string) => {
      setCurrentFilter(filter);
      return {
        data: filteredBody.data,
        isPending: filteredBody.isPending,
        error: !!filteredBody.error,
      };
    },
    [filteredBody],
  );

  return (
    <TextViewer
      text={text}
      language={language}
      stateKey={`response.body.${response.id}`}
      filterStateKey={`response.body.${response.requestId}`}
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
      onFilter={filterCallback}
    />
  );
}
