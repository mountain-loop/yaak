import classNames from 'classnames';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { createGlobalState } from 'react-use';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useFilterResponse } from '../../hooks/useFilterResponse';
import { useFormatText } from '../../hooks/useFormatText';
import type { EditorProps } from '../core/Editor/Editor';
import { Editor } from '../core/Editor/Editor';
import { hyperlink } from '../core/Editor/hyperlink/extension';
import { IconButton } from '../core/IconButton';
import { Input } from '../core/Input';

const extraExtensions = [hyperlink];

interface Props {
  pretty: boolean;
  className?: string;
  text: string;
  language: EditorProps['language'];
  responseId: string;
  requestId: string;
}

const useFilterText = createGlobalState<Record<string, string | null>>({});

export function TextViewer({ language, text, responseId, requestId, pretty, className }: Props) {
  const [filterTextMap, setFilterTextMap] = useFilterText();
  const filterText = filterTextMap[requestId] ?? null;
  const debouncedFilterText = useDebouncedValue(filterText, 200);
  const setFilterText = useCallback(
    (v: string | null) => {
      setFilterTextMap((m) => ({ ...m, [requestId]: v }));
    },
    [setFilterTextMap, requestId],
  );

  const isSearching = filterText != null;
  const filteredResponse = useFilterResponse({ filter: debouncedFilterText ?? '', responseId });

  const toggleSearch = useCallback(() => {
    if (isSearching) {
      setFilterText(null);
    } else {
      setFilterText('');
    }
  }, [isSearching, setFilterText]);

  const canFilter = language === 'json' || language === 'xml' || language === 'html';

  const actions = useMemo<ReactNode[]>(() => {
    const nodes: ReactNode[] = [];

    if (!canFilter) return nodes;

    if (isSearching) {
      nodes.push(
        <div key="input" className="w-full !opacity-100">
          <Input
            key={requestId}
            validate={!filteredResponse.error}
            hideLabel
            autoFocus
            containerClassName="bg-surface"
            size="sm"
            placeholder={language === 'json' ? 'JSONPath expression' : 'XPath expression'}
            label="Filter expression"
            name="filter"
            defaultValue={filterText}
            onKeyDown={(e) => e.key === 'Escape' && toggleSearch()}
            onChange={setFilterText}
            stateKey={`filter.${responseId}`}
          />
        </div>,
      );
    }

    nodes.push(
      <IconButton
        key="icon"
        size="sm"
        icon={isSearching ? 'x' : 'filter'}
        title={isSearching ? 'Close filter' : 'Filter response'}
        onClick={toggleSearch}
        className={classNames('border !border-border-subtle', isSearching && '!opacity-100')}
      />,
    );

    return nodes;
  }, [
    canFilter,
    filterText,
    filteredResponse.error,
    isSearching,
    language,
    requestId,
    responseId,
    setFilterText,
    toggleSearch,
  ]);

  const formattedBody = useFormatText({ text, language, pretty });

  if (formattedBody.data == null) {
    return null;
  }

  let body;
  if (isSearching && filterText?.length > 0) {
    if (filteredResponse.error) {
      body = '';
    } else {
      body = filteredResponse.data != null ? filteredResponse.data : '';
    }
  } else {
    body = formattedBody.data;
  }

  // Decode unicode sequences in the text to readable characters
  if (pretty) {
    body = decodeUnicodeLiterals(body);
  }

  return (
    <Editor
      readOnly
      className={className}
      defaultValue={body}
      language={language}
      actions={actions}
      extraExtensions={extraExtensions}
      stateKey={null}
    />
  );
}

/** Convert \uXXXX to actual Unicode characters */
function decodeUnicodeLiterals(text: string): string {
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    const charCode = parseInt(hex, 16);
    return String.fromCharCode(charCode);
  });
  return decoded;
}
