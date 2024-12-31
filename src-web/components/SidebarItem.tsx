import type { AnyModel, GrpcConnection, HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { XYCoord } from 'react-dnd';
import { useDrag, useDrop } from 'react-dnd';
import { activeRequestAtom } from '../hooks/useActiveRequest';
import { foldersAtom } from '../hooks/useFolders';
import { grpcRequestsAtom } from '../hooks/useGrpcRequests';
import { httpRequestsAtom } from '../hooks/useHttpRequests';
import { useScrollIntoView } from '../hooks/useScrollIntoView';
import { useSidebarItemCollapsed } from '../hooks/useSidebarItemCollapsed';
import { useUpdateAnyGrpcRequest } from '../hooks/useUpdateAnyGrpcRequest';
import { useUpdateAnyHttpRequest } from '../hooks/useUpdateAnyHttpRequest';
import { jotaiStore } from '../lib/jotai';
import { isResponseLoading } from '../lib/model_util';
import { HttpMethodTag } from './core/HttpMethodTag';
import { Icon } from './core/Icon';
import { StatusTag } from './core/StatusTag';
import type { SidebarTreeNode } from './Sidebar';
import { sidebarSelectedIdAtom } from './SidebarAtoms';
import { SidebarItemContextMenu } from './SidebarItemContextMenu';
import type { SidebarItemsProps } from './SidebarItems';

enum ItemTypes {
  REQUEST = 'request',
}

export type SidebarItemProps = {
  className?: string;
  itemId: string;
  itemName: string;
  itemFallbackName: string;
  itemModel: AnyModel['model'];
  onMove: (id: string, side: 'above' | 'below') => void;
  onEnd: (id: string) => void;
  onDragStart: (id: string) => void;
  children?: ReactNode;
  child: SidebarTreeNode;
  latestHttpResponse: HttpResponse | null;
  latestGrpcConnection: GrpcConnection | null;
} & Pick<SidebarItemsProps, 'onSelect'>;

type DragItem = {
  id: string;
  itemName: string;
};

export const SidebarItem = memo(function SidebarItem({
  itemName,
  itemId,
  itemModel,
  child,
  onMove,
  onEnd,
  onDragStart,
  onSelect,
  className,
  itemFallbackName,
  latestHttpResponse,
  latestGrpcConnection,
  children,
}: SidebarItemProps) {
  const ref = useRef<HTMLLIElement>(null);
  const [collapsed, toggleCollapsed] = useSidebarItemCollapsed(itemId);

  const [, connectDrop] = useDrop<DragItem, void>(
    {
      accept: ItemTypes.REQUEST,
      hover: (_, monitor) => {
        if (!ref.current) return;
        const hoverBoundingRect = ref.current?.getBoundingClientRect();
        const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        const hoverClientY = (clientOffset as XYCoord).y - hoverBoundingRect.top;
        onMove(itemId, hoverClientY < hoverMiddleY ? 'above' : 'below');
      },
    },
    [onMove],
  );

  const [, connectDrag] = useDrag<
    DragItem,
    unknown,
    {
      isDragging: boolean;
    }
  >(
    () => ({
      type: ItemTypes.REQUEST,
      item: () => {
        // Cancel drag when editing
        if (editing) return null;
        onDragStart(itemId);
        return { id: itemId, itemName };
      },
      collect: (m) => ({ isDragging: m.isDragging() }),
      options: { dropEffect: 'move' },
      end: () => onEnd(itemId),
    }),
    [onEnd],
  );

  connectDrag(connectDrop(ref));

  const updateHttpRequest = useUpdateAnyHttpRequest();
  const updateGrpcRequest = useUpdateAnyGrpcRequest();
  const [editing, setEditing] = useState<boolean>(false);

  const [selected, setSelected] = useState<boolean>(
    jotaiStore.get(sidebarSelectedIdAtom) == itemId,
  );
  useEffect(() => {
    return jotaiStore.sub(sidebarSelectedIdAtom, () => {
      const value = jotaiStore.get(sidebarSelectedIdAtom);
      setSelected(value === itemId);
    });
  }, [itemId]);

  const [active, setActive] = useState<boolean>(jotaiStore.get(activeRequestAtom)?.id === itemId);
  useEffect(
    () =>
      jotaiStore.sub(activeRequestAtom, () =>
        setActive(jotaiStore.get(activeRequestAtom)?.id === itemId),
      ),
    [itemId],
  );

  useScrollIntoView(ref.current, active);

  const handleSubmitNameEdit = useCallback(
    async (el: HTMLInputElement) => {
      if (itemModel === 'http_request') {
        await updateHttpRequest.mutateAsync({
          id: itemId,
          update: (r) => ({ ...r, name: el.value }),
        });
      } else if (itemModel === 'grpc_request') {
        await updateGrpcRequest.mutateAsync({
          id: itemId,
          update: (r) => ({ ...r, name: el.value }),
        });
      }
      setEditing(false);
    },
    [itemId, itemModel, updateGrpcRequest, updateHttpRequest],
  );

  const handleFocus = useCallback((el: HTMLInputElement | null) => {
    el?.focus();
    el?.select();
  }, []);

  const handleInputKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          await handleSubmitNameEdit(e.currentTarget);
          break;
        case 'Escape':
          e.preventDefault();
          setEditing(false);
          break;
      }
    },
    [handleSubmitNameEdit],
  );

  const handleStartEditing = useCallback(() => {
    if (itemModel !== 'http_request' && itemModel !== 'grpc_request') return;
    setEditing(true);
  }, [setEditing, itemModel]);

  const handleBlur = useCallback(
    async (e: React.FocusEvent<HTMLInputElement>) => {
      await handleSubmitNameEdit(e.currentTarget);
    },
    [handleSubmitNameEdit],
  );

  const handleSelect = useCallback(async () => {
    if (itemModel === 'folder') toggleCollapsed();
    else onSelect(itemId);
  }, [itemModel, toggleCollapsed, onSelect, itemId]);
  const [showContextMenu, setShowContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setShowContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCloseContextMenu = useCallback(() => setShowContextMenu(null), []);

  const itemAtom = useMemo(() => {
    return atom((get) => {
      if (itemModel === 'http_request') {
        return get(httpRequestsAtom).find((v) => v.id === itemId);
      } else if (itemModel === 'grpc_request') {
        return get(grpcRequestsAtom).find((v) => v.id === itemId);
      } else if (itemModel === 'folder') {
        return get(foldersAtom).find((v) => v.id === itemId);
      } else {
        return null;
      }
    });
  }, [itemId, itemModel])

  const item = useAtomValue(itemAtom);

  if (item == null) {
    return null;
  }

  const itemPrefix = (item.model === 'http_request' || item.model === 'grpc_request') && (
    <HttpMethodTag
      request={item}
      className={classNames(!(active || selected) && 'text-text-subtlest')}
    />
  );

  return (
    <li ref={ref} draggable>
      <div className={classNames(className, 'block relative group/item px-1.5 pb-0.5')}>
        <SidebarItemContextMenu
          child={child}
          show={showContextMenu}
          close={handleCloseContextMenu}
        />
        <button
          // tabIndex={-1} // Will prevent drag-n-drop
          disabled={editing}
          onClick={handleSelect}
          onDoubleClick={handleStartEditing}
          onContextMenu={handleContextMenu}
          data-active={active}
          data-selected={selected}
          className={classNames(
            'w-full flex gap-1.5 items-center h-xs px-1.5 rounded-md focus-visible:ring focus-visible:ring-border-focus outline-0',
            editing && 'ring-1 focus-within:ring-focus',
            active && 'bg-surface-highlight text-text',
            !active && 'text-text-subtle group-hover/item:text-text',
            showContextMenu && '!text-text', // Show as "active" when the context menu is open
          )}
        >
          {itemModel === 'folder' && (
            <Icon
              size="sm"
              icon="chevron_right"
              className={classNames(
                'text-text-subtlest',
                'transition-transform',
                !collapsed && 'transform rotate-90',
              )}
            />
          )}
          <div className="flex items-center gap-2 min-w-0">
            {itemPrefix}
            {editing ? (
              <input
                ref={handleFocus}
                defaultValue={itemName}
                className="bg-transparent outline-none w-full cursor-text"
                onBlur={handleBlur}
                onKeyDown={handleInputKeyDown}
              />
            ) : (
              <span className="truncate">{itemName || itemFallbackName}</span>
            )}
          </div>
          {latestGrpcConnection ? (
            <div className="ml-auto">
              {isResponseLoading(latestGrpcConnection) && (
                <Icon spin size="sm" icon="update" className="text-text-subtlest" />
              )}
            </div>
          ) : latestHttpResponse ? (
            <div className="ml-auto">
              {isResponseLoading(latestHttpResponse) ? (
                <Icon spin size="sm" icon="refresh" className="text-text-subtlest" />
              ) : (
                <StatusTag className="text-xs" response={latestHttpResponse} />
              )}
            </div>
          ) : null}
        </button>
      </div>
      {collapsed ? null : children}
    </li>
  );
});
