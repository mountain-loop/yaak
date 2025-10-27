import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { memo } from 'react';
import { hoveredParentDepthFamily, isAncestorHoveredFamily } from './atoms';

export const TreeIndentGuide = memo(function TreeIndentGuide({
  treeId,
  depth,
  ancestorIds,
}: {
  treeId: string;
  depth: number;
  ancestorIds: string[];
}) {
  const parentDepth = useAtomValue(hoveredParentDepthFamily(treeId));
  const isHovered = useAtomValue(isAncestorHoveredFamily({ treeId, ancestorIds }));

  return (
    <div className="flex">
      {Array.from({ length: depth }).map((_, i) => (
        <div
          key={i}
          className={classNames(
            'w-[calc(1rem+0.5px)] border-r border-r-text-subtlest',
            !(parentDepth === i + 1 && isHovered) && 'opacity-30',
          )}
        />
      ))}
    </div>
  );
});
