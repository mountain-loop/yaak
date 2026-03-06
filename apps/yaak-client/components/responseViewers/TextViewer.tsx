import classNames from 'classnames';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { createGlobalState } from 'react-use';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useFormatText } from '../../hooks/useFormatText';
import type { EditorProps } from '../core/Editor/Editor';
import { hyperlink } from '../core/Editor/hyperlink/extension';
import { Editor } from '../core/Editor/LazyEditor';
import { IconButton } from '../core/IconButton';
import { Input } from '../core/Input';

const extraExtensions = [hyperlink];

interface Props {
  text: string;
  language: EditorProps['language'];
  stateKey: string | null;
  pretty?: boolean;
  className?: string;
  onFilter?: (filter: string) => {
    data: string | null | undefined;
    isPending: boolean;
    error: boolean;
  };
}

const useFilterText = createGlobalState<Record<string, string | null>>({});

export function TextViewer({ language, text, stateKey, pretty, className, onFilter }: Props) {
  const [filterTextMap, setFilterTextMap] = useFilterText();
  const filterText = stateKey ? (filterTextMap[stateKey] ?? null) : null;
  const debouncedFilterText = useDebouncedValue(filterText);
  const setFilterText = useCallback(
    (v: string | null) => {
      if (!stateKey) return;
      setFilterTextMap((m) => ({ ...m, [stateKey]: v }));
    },
    [setFilterTextMap, stateKey],
  );

  const isSearching = filterText != null;
  const filteredResponse =
    onFilter && debouncedFilterText
      ? onFilter(debouncedFilterText)
      : { data: null, isPending: false, error: false };

  const toggleSearch = useCallback(() => {
    if (isSearching) {
      setFilterText(null);
    } else {
      setFilterText('');
    }
  }, [isSearching, setFilterText]);

  const canFilter = onFilter && (language === 'json' || language === 'xml' || language === 'html');

  const actions = useMemo<ReactNode[]>(() => {
    const nodes: ReactNode[] = [];

    if (!canFilter) return nodes;

    if (isSearching) {
      nodes.push(
        <div key="input" className="w-full !opacity-100">
          <Input
            key={stateKey ?? 'filter'}
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
            stateKey={stateKey ? `filter.${stateKey}` : null}
          />
        </div>,
      );
    }

    nodes.push(
      <IconButton
        key="icon"
        size="sm"
        isLoading={filteredResponse.isPending}
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
    filteredResponse.isPending,
    isSearching,
    language,
    stateKey,
    setFilterText,
    toggleSearch,
  ]);

  const formattedBody = useFormatText({ text, language, pretty: pretty ?? false });
  if (formattedBody == null) {
    return null;
  }

  let body: string;
  if (isSearching && filterText?.length > 0) {
    if (filteredResponse.error) {
      body = '';
    } else {
      body = filteredResponse.data != null ? filteredResponse.data : '';
    }
  } else {
    body = formattedBody;
  }

  // Decode unicode sequences in the text to readable characters
  if (language === 'json' && pretty) {
    body = decodeUnicodeLiterals(body);
    body = body.replace(/\\\//g, '/'); // Hide unnecessary escaping of '/' by some older frameworks
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
