import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { memo } from 'react';
import { hoveredParentDepthFamily } from './atoms';

export const TreeIndentGuide = memo(function TreeIndentGuide({
  treeId,
  depth,
}: {
  treeId: string;
  depth: number;
}) {
  const parentDepth = useAtomValue(hoveredParentDepthFamily(treeId));

  return (
    <div className="flex">
      {Array.from({ length: depth }).map((_, i) => (
        <div
          key={i}
          className={classNames(
            'w-[1rem] border-r border-r-text-subtlest',
            parentDepth !== i + 1 && 'opacity-30',
          )}
        />
      ))}
    </div>
  );
});
