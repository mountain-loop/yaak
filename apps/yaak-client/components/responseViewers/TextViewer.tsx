import classNames from "classnames";
import type { ReactNode } from "react";
import { Children, useMemo } from "react";
import { useFormatText } from "../../hooks/useFormatText";
import type { ResponseFilterApi } from "../../hooks/useResponseFilter";
import type { EditorProps } from "../core/Editor/Editor";
import { hyperlink } from "../core/Editor/hyperlink/extension";
import { Editor } from "../core/Editor/LazyEditor";
import { IconButton } from "../core/IconButton";
import { Input } from "../core/Input";

const extraExtensions = [hyperlink];

interface Props {
  text: string;
  language: EditorProps["language"];
  stateKey: string | null;
  pretty?: boolean;
  className?: string;
  footerActions?: ReactNode;
  /** Filter state, from useResponseFilter in whichever component runs the filter */
  filter?: ResponseFilterApi;
  /** Result of applying `filter.debouncedFilterText` to the body */
  filterResult?: {
    data: string | null | undefined;
    isPending: boolean;
    error: boolean;
  };
}

export function TextViewer({
  language,
  text,
  stateKey,
  pretty,
  className,
  footerActions,
  filter,
  filterResult,
}: Props) {
  const canFilter =
    filter != null && (language === "json" || language === "xml" || language === "html");
  const isSearching = filter?.isSearching ?? false;
  const filterText = filter?.filterText ?? null;
  const resultError = filterResult?.error ?? false;

  const actions = useMemo<ReactNode[]>(() => {
    const nodes: ReactNode[] = isSearching ? [] : Children.toArray(footerActions);

    if (!canFilter) return nodes;

    if (isSearching) {
      nodes.push(
        <div key="input" className="w-full opacity-100!">
          <Input
            key={filter.stateKey ?? "filter"}
            validate={!resultError}
            hideLabel
            autoFocus
            containerClassName="bg-surface"
            size="sm"
            placeholder={language === "json" ? "JSONPath expression" : "XPath expression"}
            label="Filter expression"
            name="filter"
            defaultValue={filterText}
            onKeyDown={(e) => e.key === "Escape" && filter.toggleSearch()}
            onChange={filter.setFilterText}
            stateKey={filter.stateKey ? `filter.${filter.stateKey}` : null}
          />
        </div>,
      );
    }

    nodes.push(
      <IconButton
        key="icon"
        size="sm"
        isLoading={filterResult?.isPending ?? false}
        icon={isSearching ? "x" : "filter"}
        title={isSearching ? "Close filter" : "Filter response"}
        onClick={filter.toggleSearch}
        className={classNames("border border-border-subtle!", isSearching && "opacity-100!")}
      />,
    );

    return nodes;
  }, [
    canFilter,
    footerActions,
    filter,
    filterText,
    filterResult?.isPending,
    resultError,
    isSearching,
    language,
  ]);

  const formattedBody = useFormatText({ text, language, pretty: pretty ?? false });
  if (formattedBody == null) {
    return null;
  }

  let body: string;
  if (isSearching && filterText != null && filterText.length > 0) {
    if (resultError) {
      body = "";
    } else {
      body = filterResult?.data != null ? filterResult.data : "";
    }
  } else {
    body = formattedBody;
  }

  // Decode unicode sequences in the text to readable characters
  if (language === "json" && pretty) {
    body = decodeUnicodeLiterals(body);
    body = body.replace(/\\\//g, "/"); // Hide unnecessary escaping of '/' by some older frameworks
  }

  return (
    <Editor
      readOnly
      className={className}
      defaultValue={body}
      language={language}
      actions={actions}
      extraExtensions={extraExtensions}
      stateKey={stateKey}
    />
  );
}

/** Convert \uXXXX to actual Unicode characters */
function decodeUnicodeLiterals(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    const charCode = Number.parseInt(hex, 16);
    return String.fromCharCode(charCode);
  });
}
