import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { memo } from 'react';
import { DropMarker } from '../../DropMarker';
import { hoveredParentDepthFamily, isCollapsedFamily, isIndexHoveredFamily } from './atoms';

export const TreeDropMarker = memo(function TreeDropMarker({
  className,
  treeId,
  itemId,
  index,
}: {
  treeId: string;
  index: number;
  itemId: string | null;
  className?: string;
}) {
  const isHovered = useAtomValue(isIndexHoveredFamily({ treeId, index }));
  const parentDepth = useAtomValue(hoveredParentDepthFamily(treeId));
  const collapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: itemId ?? undefined }));

  // Only show if we're hovering over this index
  if (!isHovered)  return null;

  // Don't show if we're right under a collapsed folder. We have a separate delayed expansion
  // animation for that.
  if (collapsed) return null;

  return (
    <div style={{ paddingLeft: `${parentDepth}rem` }}>
      <DropMarker className={classNames(className)} />
    </div>
  );
});
