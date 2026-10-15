import type { Extension } from "@codemirror/state";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Children, useCallback, useMemo, useState } from "react";
import { type TextFilterApi, useTextFilter } from "../../hooks/useTextFilter";
import { docFingerprint } from "../../lib/docFingerprint";
import type { CodeEditorProps } from "../editor/CodeEditor";
import { jsonBreadcrumbExtension } from "../editor/json/breadcrumbExtension";
import type { JsonPathSegment } from "../editor/json/jsonPath";
import { jsonPathToSegments, segmentsToJsonPath } from "../editor/json/jsonPath";
import { LazyCodeEditor } from "../editor/LazyCodeEditor";
import { IconButton } from "../IconButton";
import { Input } from "../Input";
import { ResponseBreadcrumbBar } from "./ResponseBreadcrumbBar";

export interface TextViewerProps {
  text: string;
  language: CodeEditorProps["language"];
  stateKey: string | null;
  pretty?: boolean;
  className?: string;
  footerActions?: ReactNode;
  extensions?: Extension[];
  /** Pretty-prints the text when `pretty` is set */
  formatText?: (text: string, language: CodeEditorProps["language"]) => Promise<string>;
  /** Evaluates a JSONPath or XPath expression, rejecting when it's invalid. Enables the filter box */
  filterText?: (expression: string) => Promise<string | null>;
  /** Where the filter's state is kept, when it outlives the text (defaults to `stateKey`) */
  filterStateKey?: string | null;
  /** Called once the filter has accepted an applied expression */
  onFilterApplied?: (expression: string) => void;
  /** Rendered at the start of the filter box */
  filterLeftSlot?: (filter: TextFilterApi) => ReactNode;
  /** Renders the editors, for a host whose editor builds on CodeEditor */
  renderEditor?: (props: CodeEditorProps) => ReactNode;
}

export function TextViewer({
  language,
  text,
  stateKey,
  pretty,
  className,
  footerActions,
  extensions,
  formatText,
  filterText,
  filterStateKey = stateKey,
  onFilterApplied,
  filterLeftSlot,
  renderEditor = renderCodeEditor,
}: TextViewerProps) {
  // Track the JSON path under the cursor to drive the breadcrumb bar. Selection
  // works even in this read-only editor, so it updates as the user clicks around.
  const [breadcrumbSegments, setBreadcrumbSegments] = useState<JsonPathSegment[]>([]);
  const handleBreadcrumbUpdate = useCallback(
    ({ segments }: { segments: JsonPathSegment[] | null }) =>
      setBreadcrumbSegments((prev) => {
        const next = segments ?? [];
        return segmentsToJsonPath(prev) === segmentsToJsonPath(next) ? prev : next;
      }),
    [],
  );
  const extraExtensions = useMemo(
    () =>
      language === "json"
        ? [...(extensions ?? []), jsonBreadcrumbExtension(handleBreadcrumbUpdate)]
        : (extensions ?? []),
    [language, extensions, handleBreadcrumbUpdate],
  );

  const filter = useTextFilter({
    stateKey: filterStateKey,
    runFilter: filterText ?? rejectFilter,
    onApplied: onFilterApplied,
  });
  const hasFilter = filterText != null;

  // Exact, so two same-length bodies never share a cached filter result
  const textFingerprint = useMemo(() => docFingerprint(text, { exact: true }), [text]);
  const filterResult = useQuery({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: [
      "text_viewer_filter",
      filterStateKey,
      stateKey,
      textFingerprint,
      filter.appliedFilter,
    ],
    queryFn: () => (filterText ?? rejectFilter)(filter.appliedFilter ?? ""),
    enabled: hasFilter && filter.appliedFilter != null,
  });

  const canFilter = hasFilter && (language === "json" || language === "xml" || language === "html");
  const { isSearching, appliedFilter } = filter;
  const resultError = !!filterResult.error;

  // Filter output is always an array of matches, so under a plain-path filter the
  // cursor's leading index is that single match and the rest extends the filter.
  const appliedSegments =
    appliedFilter != null && language === "json" ? jsonPathToSegments(appliedFilter) : null;
  const pathSegments =
    appliedSegments != null
      ? [...appliedSegments, ...breadcrumbSegments.slice(1)]
      : breadcrumbSegments;
  const showBreadcrumbs =
    hasFilter && (appliedFilter != null || (language === "json" && breadcrumbSegments.length > 0));

  const handleFilterKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        filter.toggleSearch();
      } else if (e.key === "Enter" && filter.filterText != null) {
        filter.applyFilter(filter.filterText);
      }
    },
    [filter],
  );

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
            defaultValue={filter.filterText}
            forceUpdateKey={filter.filterUpdateKey}
            onKeyDown={handleFilterKeyDown}
            onChange={filter.setFilterText}
            stateKey={filter.stateKey ? `filter.${filter.stateKey}` : null}
            renderEditor={renderEditor}
            leftSlot={filterLeftSlot?.(filter)}
            rightSlot={
              <div className="py-0.5 flex">
                <IconButton
                  size="xs"
                  icon="x"
                  title="Close filter"
                  iconColor="secondary"
                  onClick={filter.toggleSearch}
                  className="w-8 mr-0.5 h-auto!"
                />
              </div>
            }
          />
        </div>,
      );
    } else {
      nodes.push(
        <IconButton
          key="icon"
          size="sm"
          isLoading={filterResult.isPending && filterResult.isFetching}
          icon="filter"
          title="Filter response"
          onClick={filter.toggleSearch}
          className="border border-border-subtle!"
        />,
      );
    }

    return nodes;
  }, [
    canFilter,
    footerActions,
    filter,
    filterResult.isPending,
    filterResult.isFetching,
    filterLeftSlot,
    renderEditor,
    resultError,
    isSearching,
    language,
    handleFilterKeyDown,
  ]);

  const formattedBody = useQuery({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: ["text_viewer_format", text, language, pretty ?? false],
    queryFn: async () => {
      if (text === "" || !pretty || formatText == null) {
        return text;
      }
      return formatText(text, language);
    },
  }).data;
  if (formattedBody == null) {
    return null;
  }

  let body: string;
  if (appliedFilter) {
    if (resultError) {
      body = "";
    } else {
      body = filterResult.data != null ? filterResult.data : "";
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
    <div className="relative h-full w-full">
      {renderEditor({
        readOnly: true,
        className,
        defaultValue: body,
        language,
        actions,
        extensions: extraExtensions,
        stateKey,
      })}
      {showBreadcrumbs && (
        <div className="absolute top-0 right-3 max-w-[70%] pointer-events-none">
          <ResponseBreadcrumbBar
            segments={language === "json" ? pathSegments : []}
            appliedFilter={appliedFilter}
            appliedDepth={appliedSegments?.length ?? null}
            filterError={resultError}
            onSelect={(count) =>
              filter.replaceFilter(count === 0 ? "" : segmentsToJsonPath(pathSegments, count))
            }
          />
        </div>
      )}
    </div>
  );
}

function renderCodeEditor(props: CodeEditorProps) {
  return <LazyCodeEditor {...props} />;
}

function rejectFilter(): Promise<string | null> {
  return Promise.reject(new Error("No filter"));
}

/** Convert \uXXXX to actual Unicode characters */
function decodeUnicodeLiterals(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    const charCode = Number.parseInt(hex, 16);
    return String.fromCharCode(charCode);
  });
}
