import { yaml } from '@codemirror/lang-yaml';
import { syntaxHighlighting } from '@codemirror/language';
import { MergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import classNames from 'classnames';
import { useEffect, useRef } from 'react';
import './DiffViewer.css';
import { readonlyExtensions, syntaxHighlightStyle } from './extensions';

interface Props {
  /** Original/previous version (left side) */
  original: string;
  /** Modified/current version (right side) */
  modified: string;
  className?: string;
}

export function DiffViewer({ original, modified, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous instance
    viewRef.current?.destroy();

    const sharedExtensions = [
      yaml(),
      syntaxHighlighting(syntaxHighlightStyle),
      ...readonlyExtensions,
      EditorView.lineWrapping,
    ];

    viewRef.current = new MergeView({
      a: {
        doc: original,
        extensions: sharedExtensions,
      },
      b: {
        doc: modified,
        extensions: sharedExtensions,
      },
      parent: containerRef.current,
      collapseUnchanged: { margin: 2, minSize: 3 },
      highlightChanges: false,
      gutter: true,
      orientation: 'a-b',
      revertControls: undefined,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [original, modified]);

  return (
    <div
      ref={containerRef}
      className={classNames('cm-wrapper cm-multiline h-full w-full', className)}
    />
  );
}
