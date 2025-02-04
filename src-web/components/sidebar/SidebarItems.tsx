import classNames from 'classnames';
import React, { Fragment, memo } from 'react';
import { useGrpcConnections } from '../../hooks/useGrpcConnections';
import { useHttpResponses } from '../../hooks/useHttpResponses';
import { useWebsocketConnections } from '../../hooks/useWebsocketConnections';
import { VStack } from '../core/Stacks';
import { DropMarker } from '../DropMarker';
import type { SidebarTreeNode } from './Sidebar';
import { SidebarItem } from './SidebarItem';

export interface SidebarItemsProps {
  tree: SidebarTreeNode;
  draggingId: string | null;
  selectedTree: SidebarTreeNode | null;
  treeParentMap: Record<string, SidebarTreeNode>;
  hoveredTree: SidebarTreeNode | null;
  hoveredIndex: number | null;
  handleMove: (id: string, side: 'above' | 'below') => void;
  handleEnd: (id: string) => void;
  handleDragStart: (id: string) => void;
  onSelect: (requestId: string) => void;
}

export const SidebarItems = memo(function SidebarItems({
  tree,
  selectedTree,
  draggingId,
  onSelect,
  treeParentMap,
  hoveredTree,
  hoveredIndex,
  handleEnd,
  handleMove,
  handleDragStart,
}: SidebarItemsProps) {
  const httpResponses = useHttpResponses();
  const grpcConnections = useGrpcConnections();
  const websocketConnections = useWebsocketConnections();

  return (
    <VStack
      as="ul"
      role="menu"
      aria-orientation="vertical"
      dir="ltr"
      className={classNames(
        tree.depth > 0 && 'border-l border-border-subtle',
        tree.depth === 0 && 'ml-0',
        tree.depth >= 1 && 'ml-[1.2rem]',
      )}
    >
      {tree.children.map((child, i) => {
        return (
          <Fragment key={child.id}>
            {hoveredIndex === i && hoveredTree?.id === tree.id && <DropMarker />}
            <SidebarItem
              itemId={child.id}
              itemName={child.name}
              itemModel={child.model}
              latestHttpResponse={httpResponses.find((r) => r.requestId === child.id) ?? null}
              latestGrpcConnection={grpcConnections.find((c) => c.requestId === child.id) ?? null}
              latestWebsocketConnection={
                websocketConnections.find((c) => c.requestId === child.id) ?? null
              }
              onMove={handleMove}
              onEnd={handleEnd}
              onSelect={onSelect}
              onDragStart={handleDragStart}
              child={child}
            >
              {child.model === 'folder' && draggingId !== child.id ? (
                <SidebarItems
                  draggingId={draggingId}
                  handleDragStart={handleDragStart}
                  handleEnd={handleEnd}
                  handleMove={handleMove}
                  hoveredIndex={hoveredIndex}
                  hoveredTree={hoveredTree}
                  onSelect={onSelect}
                  selectedTree={selectedTree}
                  tree={child}
                  treeParentMap={treeParentMap}
                />
              ) : null}
            </SidebarItem>
          </Fragment>
        );
      })}
      {hoveredIndex === tree.children.length && hoveredTree?.id === tree.id && <DropMarker />}
    </VStack>
  );
});
