import useSize from '@react-hook/size';
import classNames from 'classnames';
import { useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useKeyValue } from '../hooks/useKeyValue';
import {Editor} from "./core/Editor/Editor";
import { IconButton } from './core/IconButton';
import { SplitLayout } from './core/SplitLayout';
import { VStack } from './core/Stacks';
import { Prose } from './Prose';

interface Props {
  placeholder: string;
  className?: string;
  defaultValue: string;
  onChange: (value: string) => void;
  name: string;
}

export function MarkdownEditor({ className, defaultValue, onChange, name, placeholder }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [width] = useSize(containerRef.current);
  const wideEnoughForSplit = width > 600;

  const { set: setViewMode, value: rawViewMode } = useKeyValue<'edit' | 'preview' | 'both'>({
    namespace: 'global',
    key: ['md_view', name],
    fallback: 'edit',
  });

  if (rawViewMode == null) return null;

  let viewMode = rawViewMode;
  if (rawViewMode === 'both' && !wideEnoughForSplit) {
    viewMode = 'edit';
  }

  const editor = (
    <Editor
      className="max-w-xl"
      language="markdown"
      defaultValue={defaultValue}
      onChange={onChange}
      placeholder={placeholder}
      hideGutter
      wrapLines
    />
  );

  const preview =
    defaultValue.length === 0 ? (
      <p className="text-text-subtle">No description</p>
    ) : (
      <Prose className="max-w-xl">
        <Markdown
          remarkPlugins={[remarkGfm]}
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
    <div
      ref={containerRef}
      className={classNames(
        'w-full h-full pt-1.5 group rounded-md grid grid-cols-[minmax(0,1fr)_auto]',
        className,
      )}
    >
      <div className="pr-8 h-full w-full">{contents}</div>
      <VStack
        space={1}
        className="bg-surface opacity-20 group-hover:opacity-100 transition-opacity transform-gpu"
      >
        <IconButton
          size="xs"
          icon="text"
          title="Switch to edit mode"
          className={classNames(viewMode === 'edit' && 'bg-surface-highlight !text-text')}
          event={{ id: 'md_mode', mode: viewMode }}
          onClick={() => setViewMode('edit')}
        />
        {wideEnoughForSplit && (
          <IconButton
            size="xs"
            icon="columns_2"
            title="Switch to edit mode"
            className={classNames(viewMode === 'both' && 'bg-surface-highlight !text-text')}
            event={{ id: 'md_mode', mode: viewMode }}
            onClick={() => setViewMode('both')}
          />
        )}
        <IconButton
          size="xs"
          icon="eye"
          title="Switch to preview mode"
          className={classNames(viewMode === 'preview' && 'bg-surface-highlight !text-text')}
          event={{ id: 'md_mode', mode: viewMode }}
          onClick={() => setViewMode('preview')}
        />
      </VStack>
    </div>
  );
}
