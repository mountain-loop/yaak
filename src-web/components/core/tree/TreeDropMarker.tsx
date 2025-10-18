import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { memo } from 'react';
import { DropMarker } from '../../DropMarker';
import { hoveredParentDepthFamily, isCollapsedFamily, isIndexHoveredFamily } from './atoms';
import type { TreeNode } from './common';

export const TreeDropMarker = memo(function TreeDropMarker<T extends { id: string }>({
  className,
  treeId,
  node,
  index,
}: {
  treeId: string;
  index: number;
  node: TreeNode<T> | null;
  className?: string;
}) {
  const itemId = node?.item.id;
  const isHovered = useAtomValue(isIndexHoveredFamily({ treeId, index }));
  const parentDepth = useAtomValue(hoveredParentDepthFamily(treeId));
  const collapsed = useAtomValue(isCollapsedFamily({ treeId, itemId }));

  // Only show if we're hovering over this index
  if (!isHovered) return null;

  // Don't show if we're right under a collapsed folder, or empty folder. We have a separate
  // delayed expansion animation for that.
  if (collapsed || node?.children?.length === 0) return null;

  return (
    <div className="drop-marker" style={{ paddingLeft: `${parentDepth}rem` }}>
      <DropMarker className={classNames(className)} />
    </div>
  );
});
