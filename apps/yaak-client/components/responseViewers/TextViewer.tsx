import type { ReactNode } from "react";
import { Children, useCallback, useMemo, useState } from "react";
import { useFormatText } from "../../hooks/useFormatText";
import type { ResponseFilterApi } from "../../hooks/useResponseFilter";
import type { EditorProps } from "../core/Editor/Editor";
import { jsonBreadcrumbExtension } from "../core/Editor/json/breadcrumbExtension";
import type { JsonPathSegment } from "../core/Editor/json/jsonPath";
import { jsonPathToSegments, segmentsToJsonPath } from "../core/Editor/json/jsonPath";
import { hyperlink } from "../core/Editor/hyperlink/extension";
import { Editor } from "../core/Editor/LazyEditor";
import { IconButton } from "../core/IconButton";
import { Input } from "../core/Input";
import { ResponseBreadcrumbBar } from "./ResponseBreadcrumbBar";
import { RecentFiltersDropdown } from "./RecentFiltersDropdown";

interface Props {
  text: string;
  language: EditorProps["language"];
  stateKey: string | null;
  pretty?: boolean;
  className?: string;
  footerActions?: ReactNode;
  filter?: ResponseFilterApi;
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
        ? [hyperlink, jsonBreadcrumbExtension(handleBreadcrumbUpdate)]
        : [hyperlink],
    [language, handleBreadcrumbUpdate],
  );

  const canFilter =
    filter != null && (language === "json" || language === "xml" || language === "html");
  const isSearching = filter?.isSearching ?? false;
  const appliedFilter = filter?.appliedFilter ?? null;
  const resultError = filterResult?.error ?? false;

  // Filter output is always an array of matches, so under a plain-path filter the
  // cursor's leading index is that single match and the rest extends the filter.
  const appliedSegments =
    appliedFilter != null && language === "json" ? jsonPathToSegments(appliedFilter) : null;
  const pathSegments =
    appliedSegments != null
      ? [...appliedSegments, ...breadcrumbSegments.slice(1)]
      : breadcrumbSegments;
  const showBreadcrumbs =
    filter != null &&
    (appliedFilter != null || (language === "json" && breadcrumbSegments.length > 0));

  const handleFilterKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (filter == null) return;
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
            leftSlot={
              <div className="py-0.5 flex">
                <RecentFiltersDropdown
                  recentFilters={filter.recentFilters}
                  activeFilter={filter.appliedFilter}
                  onSelect={filter.replaceFilter}
                  onRemove={filter.removeRecentFilter}
                  onTogglePin={filter.togglePinRecentFilter}
                  onClear={filter.clearRecentFilters}
                />
              </div>
            }
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
          isLoading={filterResult?.isPending ?? false}
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
    filterResult?.isPending,
    resultError,
    isSearching,
    language,
    handleFilterKeyDown,
  ]);

  const formattedBody = useFormatText({ text, language, pretty: pretty ?? false });
  if (formattedBody == null) {
    return null;
  }

  let body: string;
  if (appliedFilter) {
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
    <div className="relative h-full w-full">
      <Editor
        readOnly
        className={className}
        defaultValue={body}
        language={language}
        actions={actions}
        extraExtensions={extraExtensions}
        stateKey={stateKey}
      />
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

/** Convert \uXXXX to actual Unicode characters */
function decodeUnicodeLiterals(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    const charCode = Number.parseInt(hex, 16);
    return String.fromCharCode(charCode);
  });
}
