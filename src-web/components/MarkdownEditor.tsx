import classNames from 'classnames';
import { useRef, useState } from 'react';
import type { EditorProps } from './core/Editor/Editor';
import { Editor } from './core/Editor/LazyEditor';
import { SegmentedControl } from './core/SegmentedControl';
import { Markdown } from './Markdown';

type ViewMode = 'edit' | 'preview';

interface Props extends Pick<EditorProps, 'heightMode' | 'stateKey' | 'forceUpdateKey'> {
  placeholder: string;
  className?: string;
  editorClassName?: string;
  defaultValue: string;
  onChange: (value: string) => void;
  name: string;
}

export function MarkdownEditor({
  className,
  editorClassName,
  defaultValue,
  onChange,
  name,
  forceUpdateKey,
  ...editorProps
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(defaultValue ? 'preview' : 'edit');

  const containerRef = useRef<HTMLDivElement>(null);

  const editor = (
    <Editor
      hideGutter
      wrapLines
      className={classNames(editorClassName, '[&_.cm-line]:!max-w-lg max-h-full')}
      language="markdown"
      defaultValue={defaultValue}
      onChange={onChange}
      forceUpdateKey={forceUpdateKey}
      {...editorProps}
    />
  );

  const preview =
    defaultValue.length === 0 ? (
      <p className="text-text-subtlest">No description</p>
    ) : (
      <div className="pr-1.5 overflow-y-auto max-h-full [&_*]:cursor-auto [&_*]:select-auto">
        <Markdown className="max-w-lg select-auto cursor-auto">{defaultValue}</Markdown>
      </div>
    );

  const contents = viewMode === 'preview' ? preview : editor;

  return (
    <div
      ref={containerRef}
      className={classNames(
        'group/markdown',
        'relative w-full h-full pt-1.5 rounded-md gap-x-1.5',
        'min-w-0', // Not sure why this is needed
        className,
      )}
    >
      <div className="h-full w-full">{contents}</div>
      <div className="absolute top-0 right-0 pt-1.5 pr-1.5">
        <SegmentedControl
          name={name}
          onChange={setViewMode}
          value={viewMode}
          options={[
            { icon: 'eye', label: 'Preview mode', value: 'preview' },
            { icon: 'pencil', label: 'Edit mode', value: 'edit' },
          ]}
        />
      </div>
    </div>
  );
}
