import { lazy, Suspense } from 'react';
import type { EditorProps } from './Editor';

const Editor_ = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));

export function Editor(props: EditorProps) {
  return (
    <Suspense>
      <Editor_ {...props} />
    </Suspense>
  );
}
