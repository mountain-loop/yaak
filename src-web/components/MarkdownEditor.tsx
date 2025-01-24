import classNames from 'classnames';
import { useRef, useState } from 'react';
import type { EditorProps } from './core/Editor/Editor';
import { Editor } from './core/Editor/Editor';
import { SegmentedControl } from './core/SegmentedControl';
import { Markdown } from './Markdown';

type ViewMode = 'edit' | 'preview';

interface Props extends Pick<EditorProps, 'heightMode' | 'stateKey' | 'forceUpdateKey'> {
  placeholder: string;
  className?: string;
  defaultValue: string;
  onChange: (value: string) => void;
  name: string;
}

export function MarkdownEditor({
  className,
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
      className="max-w-2xl max-h-full"
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
      <Markdown className="max-w-xl overflow-y-auto max-h-full [&_*]:cursor-auto [&_*]:select-auto">
        {defaultValue}
      </Markdown>
    );

  const contents = viewMode === 'preview' ? preview : editor;

  return (
    <div
      ref={containerRef}
      className={classNames(
        'group/markdown',
        'w-full h-full pt-1.5 rounded-md grid grid-cols-[minmax(0,1fr)_auto] grid-rows-1 gap-x-1.5',
        className,
      )}
    >
      <div className="h-full w-full">{contents}</div>
      <SegmentedControl
        name={name}
        onChange={setViewMode}
        value={viewMode}
        options={[
          {
            event: { id: 'md_mode', mode: 'preview' },
            icon: 'eye',
            label: 'Preview mode',
            value: 'preview',
          },
          {
            event: { id: 'md_mode', mode: 'edit' },
            icon: 'pencil',
            label: 'Edit mode',
            value: 'edit',
          },
        ]}
      />
    </div>
  );
}
