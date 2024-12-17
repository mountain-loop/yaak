import useSize from '@react-hook/size';
import classNames from 'classnames';
import { useRef } from 'react';
import Markdown from 'react-markdown';
import { useKeyValue } from '../hooks/useKeyValue';
import { Editor } from './core/Editor';
import { IconButton } from './core/IconButton';
import { SplitLayout } from './core/SplitLayout';
import { VStack } from './core/Stacks';
import { Prose } from './Prose';

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
}

export function MarkdownEditor({ defaultValue, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [width] = useSize(containerRef.current);
  const wideEnoughForSplit = width > 550;

  const {
    set: setViewMode,
    value: rawViewMode,
    isLoading,
  } = useKeyValue<'edit' | 'preview' | 'both'>({
    namespace: 'global',
    key: 'md_view',
    fallback: 'edit',
  });

  const viewMode = rawViewMode === 'both' && !wideEnoughForSplit ? 'edit' : rawViewMode;

  if (isLoading) return null;

  const editor = (
    <Editor
      className="max-w-xl"
      language="markdown"
      defaultValue={defaultValue}
      onChange={onChange}
      hideGutter
      wrapLines
    />
  );

  const preview = (
    <Prose className="max-w-xl">
      <Markdown
        components={{
          a: ({ href, children, ...rest }) => {
            if (href && !href.match(/https?:\/\//)) {
              href = `http://${href}`;
            }
            return (
              <a target="_blank" rel="noreferrer noopener" href={href} {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {defaultValue}
      </Markdown>
    </Prose>
  );

  const contents =
    viewMode === 'both' ? (
      <SplitLayout
        name="markdown-editor"
        layout="horizontal"
        firstSlot={({ style }) => <div style={style}>{editor}</div>}
        secondSlot={({ style }) => (
          <div style={style} className="border-l border-border-subtle pl-6">
            {preview}
          </div>
        )}
      />
    ) : viewMode === 'preview' ? (
      preview
    ) : (
      editor
    );

  return (
    <div ref={containerRef} className="relative w-full h-full pt-1.5 group">
      <VStack
        space={1}
        className="absolute top-0 right-0 z-10 bg-surface opacity-30 group-hover:opacity-100 transition"
      >
        <IconButton
          size="xs"
          icon="text"
          title="Switch to edit mode"
          className={classNames(viewMode === 'edit' && 'bg-surface-highlight !text-text')}
          onClick={() => setViewMode('edit')}
        />
        {wideEnoughForSplit && (
          <IconButton
            size="xs"
            icon="columns_2"
            title="Switch to edit mode"
            className={classNames(viewMode === 'both' && 'bg-surface-highlight !text-text')}
            onClick={() => setViewMode('both')}
          />
        )}
        <IconButton
          size="xs"
          icon="eye"
          title="Switch to preview mode"
          className={classNames(viewMode === 'preview' && 'bg-surface-highlight !text-text')}
          onClick={() => setViewMode('preview')}
        />
      </VStack>
      <div className="pr-8 h-full w-full">{contents}</div>
    </div>
  );
}
