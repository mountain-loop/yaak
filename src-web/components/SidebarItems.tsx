import type { GrpcConnection, HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import React, { Fragment, memo } from 'react';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { VStack } from './core/Stacks';
import { DropMarker } from './DropMarker';
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
  isCollapsed: (id: string) => boolean;
  httpResponses: HttpResponse[];
  grpcConnections: GrpcConnection[];
}

function SidebarItems_({
  tree,
  selectedTree,
  draggingId,
  onSelect,
  treeParentMap,
  isCollapsed,
  hoveredTree,
  hoveredIndex,
  handleEnd,
  handleMove,
  handleDragStart,
  httpResponses,
  grpcConnections,
}: SidebarItemsProps) {
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
          <Fragment key={child.item.id}>
            {hoveredIndex === i && hoveredTree?.item.id === tree.item.id && <DropMarker />}
            <SidebarItem
              itemId={child.item.id}
              itemName={child.item.name}
              itemFallbackName={
                child.item.model === 'http_request' || child.item.model === 'grpc_request'
                  ? fallbackRequestName(child.item)
                  : 'New Folder'
              }
              itemModel={child.item.model}
              latestHttpResponse={httpResponses.find((r) => r.requestId === child.item.id) ?? null}
              latestGrpcConnection={
                grpcConnections.find((c) => c.requestId === child.item.id) ?? null
              }
              onMove={handleMove}
              onEnd={handleEnd}
              onSelect={onSelect}
              onDragStart={handleDragStart}
              isCollapsed={isCollapsed}
              child={child}
            >
              {child.item.model === 'folder' &&
                !isCollapsed(child.item.id) &&
                draggingId !== child.item.id && (
                  <SidebarItems
                    draggingId={draggingId}
                    handleDragStart={handleDragStart}
                    handleEnd={handleEnd}
                    handleMove={handleMove}
                    hoveredIndex={hoveredIndex}
                    hoveredTree={hoveredTree}
                    httpResponses={httpResponses}
                    grpcConnections={grpcConnections}
                    isCollapsed={isCollapsed}
                    onSelect={onSelect}
                    selectedTree={selectedTree}
                    tree={child}
                    treeParentMap={treeParentMap}
                  />
                )}
            </SidebarItem>
          </Fragment>
        );
      })}
      {hoveredIndex === tree.children.length && hoveredTree?.item.id === tree.item.id && (
        <DropMarker />
      )}
    </VStack>
  );
}

export const SidebarItems = memo<SidebarItemsProps>(SidebarItems_, (a, b) => {
  const different = [];
  for (const key of Object.keys(a) as (keyof SidebarItemsProps)[]) {
    if (a[key] !== b[key]) {
      different.push(key);
    }
  }
  if (different.length > 0) {
    console.log('ITEMS DIFFERENT -------------------', different.join(', '));
  }
  return different.length === 0;
});
