import classNames from 'classnames';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { createGlobalState } from 'react-use';
import { useCopy } from '../../hooks/useCopy';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useFilterResponse } from '../../hooks/useFilterResponse';
import { useFormatText } from '../../hooks/useFormatText';
import { useToggle } from '../../hooks/useToggle';
import { CopyButton } from '../CopyButton';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import type { EditorProps } from '../core/Editor';
import { Editor } from '../core/Editor';
import { hyperlink } from '../core/Editor/hyperlink/extension';
import { IconButton } from '../core/IconButton';
import { InlineCode } from '../core/InlineCode';
import { Input } from '../core/Input';
import { SizeTag } from '../core/SizeTag';
import { HStack } from '../core/Stacks';

const extraExtensions = [hyperlink];
const LARGE_RESPONSE_BYTES = 2 * 1000 * 1000;

interface Props {
  pretty: boolean;
  className?: string;
  text: string;
  language: EditorProps['language'];
  responseId: string;
  requestId: string;
  onSaveResponse: () => void;
}

const useFilterText = createGlobalState<Record<string, string | null>>({});

export function TextViewer({
  language,
  text,
  responseId,
  requestId,
  pretty,
  className,
  onSaveResponse,
}: Props) {
  const [filterTextMap, setFilterTextMap] = useFilterText();
  const [showLargeResponse, toggleShowLargeResponse] = useToggle();
  const filterText = filterTextMap[requestId] ?? null;
  const copy = useCopy();
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
    setFilterText,
    toggleSearch,
  ]);

  const formattedBody = useFormatText({ text, language, pretty });

  if (!showLargeResponse && text.length > LARGE_RESPONSE_BYTES) {
    return (
      <Banner color="primary" className="h-full flex flex-col gap-3">
        <p>
          Showing responses over{' '}
          <InlineCode>
            <SizeTag contentLength={LARGE_RESPONSE_BYTES} />
          </InlineCode>{' '}
          may impact performance
        </p>
        <HStack wrap space={2}>
          <Button color="primary" size="xs" onClick={toggleShowLargeResponse}>
            Reveal Response
          </Button>
          <Button variant="border" size="xs" onClick={onSaveResponse}>
            Save to File
          </Button>
          <CopyButton variant="border" size="xs" onClick={() => copy(text)} text={text} />
        </HStack>
      </Banner>
    );
  }

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

  return (
    <Editor
      readOnly
      className={className}
      defaultValue={body}
      language={language}
      actions={actions}
      extraExtensions={extraExtensions}
    />
  );
}
