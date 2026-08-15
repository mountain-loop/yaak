import type { ReactNode } from "react";
import { Children, useCallback, useMemo } from "react";
import { Banner, HStack, Icon, InlineCode } from "@yaakapp-internal/ui";
import { useFormatText } from "../../hooks/useFormatText";
import type { ResponseFilterApi } from "../../hooks/useResponseFilter";
import { Button } from "../core/Button";
import type { EditorProps } from "../core/Editor/Editor";
import { hyperlink } from "../core/Editor/hyperlink/extension";
import { Editor } from "../core/Editor/LazyEditor";
import { IconButton } from "../core/IconButton";
import { Input } from "../core/Input";
import { RecentFiltersDropdown } from "./RecentFiltersDropdown";

const extraExtensions = [hyperlink];

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
  const canFilter =
    filter != null && (language === "json" || language === "xml" || language === "html");
  const isSearching = filter?.isSearching ?? false;
  const appliedFilter = filter?.appliedFilter ?? null;
  const resultError = filterResult?.error ?? false;

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
    <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full w-full">
      {appliedFilter && filter != null ? (
        <AppliedFilterBar
          filter={appliedFilter}
          error={resultError}
          onClear={() => filter.replaceFilter("")}
        />
      ) : (
        <span />
      )}
      <Editor
        readOnly
        className={className}
        defaultValue={body}
        language={language}
        actions={actions}
        extraExtensions={extraExtensions}
        stateKey={stateKey}
      />
    </div>
  );
}

/**
 * Shows what's actually filtering the body, which the filter box below can't convey
 * once it holds an edited expression that hasn't been applied yet.
 */
function AppliedFilterBar({
  filter,
  error,
  onClear,
}: {
  filter: string;
  error: boolean;
  onClear: () => void;
}) {
  return (
    <Banner color={error ? "danger" : "info"} className="py-1! mb-2! text-sm">
      <HStack space={2} className="min-w-0">
        <Icon icon="filter" size="xs" className="shrink-0 opacity-70" />
        <span className="truncate min-w-0" title={filter}>
          Response filtered by <InlineCode>{filter}</InlineCode>
          {error && " (invalid expression)"}
        </span>
        <Button
          size="2xs"
          variant="border"
          color={error ? "danger" : "info"}
          className="ml-auto shrink-0"
          onClick={onClear}
        >
          Clear
        </Button>
      </HStack>
    </Banner>
  );
}

/** Convert \uXXXX to actual Unicode characters */
function decodeUnicodeLiterals(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    const charCode = Number.parseInt(hex, 16);
    return String.fromCharCode(charCode);
  });
}
