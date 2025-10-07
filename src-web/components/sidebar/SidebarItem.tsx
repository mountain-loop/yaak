import type {
  AnyModel,
  GrpcConnection,
  HttpResponse,
  WebsocketConnection,
} from '@yaakapp-internal/models';
import { foldersAtom, patchModelById } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import type { ReactElement } from 'react';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { XYCoord } from 'react-dnd';
import { useDrag, useDrop } from 'react-dnd';
import { allRequestsAtom } from '../../hooks/useAllRequests';
import { useSidebarItemCollapsed } from '../../hooks/useSidebarItemCollapsed';
import { jotaiStore } from '../../lib/jotai';
import { HttpMethodTag } from '../core/HttpMethodTag';
import { HttpStatusTag } from '../core/HttpStatusTag';
import { Icon } from '../core/Icon';
import { LoadingIcon } from '../core/LoadingIcon';
import type { DragItem } from './dnd';
import { ItemTypes } from './dnd';
import type { SidebarTreeNode } from './Sidebar';
import { sidebarActiveIdAtom, sidebarSelectedIdAtom } from './SidebarAtoms';
import { SidebarItemContextMenu } from './SidebarItemContextMenu';
import type { SidebarItemsProps } from './SidebarItems';

export type SidebarItemProps = {
  className?: string;
  itemId: string;
  itemName: string;
  itemModel: AnyModel['model'];
  onMove: (id: string, side: 'above' | 'below') => void;
  onEnd: (id: string) => void;
  onDragStart: (id: string) => void;
  children: ReactElement<typeof SidebarItem> | null;
  child: SidebarTreeNode;
  latestHttpResponse: HttpResponse | null;
  latestGrpcConnection: GrpcConnection | null;
  latestWebsocketConnection: WebsocketConnection | null;
} & Pick<SidebarItemsProps, 'onSelect'>;

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
  latestHttpResponse,
  latestGrpcConnection,
  latestWebsocketConnection,
  children,
}: SidebarItemProps) {
  const ref = useRef<HTMLLIElement>(null);
  const [collapsed, toggleCollapsed] = useSidebarItemCollapsed(itemId);

  const [, connectDrop] = useDrop<DragItem, void>(
    {
      accept: [ItemTypes.REQUEST, ItemTypes.SIDEBAR],
      hover: (_, monitor) => {
        if (!ref.current) return;
        if (!monitor.isOver()) return;
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

  const [editing, setEditing] = useState<boolean>(false);

  const [active, setActive] = useState<boolean>(jotaiStore.get(sidebarActiveIdAtom) === itemId);
  const [selected, setSelected] = useState<boolean>(jotaiStore.get(sidebarSelectedIdAtom) === itemId);

  useEffect(() => {
    return jotaiStore.sub(sidebarSelectedIdAtom, () => {
      const value = jotaiStore.get(sidebarSelectedIdAtom);
      setSelected(value === itemId);
    });
  }, [itemId]);

  useEffect(() => {
    jotaiStore.sub(sidebarActiveIdAtom, () => {
      const isActive = jotaiStore.get(sidebarActiveIdAtom) === itemId;
      setActive(isActive);
    });
    jotaiStore.sub(sidebarSelectedIdAtom, () => {
      const isSelected = jotaiStore.get(sidebarSelectedIdAtom) === itemId;
      setSelected(isSelected);
      if (isSelected) {
        ref.current?.scrollIntoView({ block: 'nearest' });
      }
    });
  }, [itemId]);

  const handleSubmitNameEdit = useCallback(
    async (el: HTMLInputElement) => {
      await patchModelById(itemModel, itemId, { name: el.value });

      // Slight delay for the model to propagate to the local store
      setTimeout(() => setEditing(false));
    },
    [itemId, itemModel],
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

  const handleDoubleClick = useCallback(() => {
    if (
      itemModel === 'http_request' ||
      itemModel === 'grpc_request' ||
      itemModel === 'websocket_request'
    ) {
      setEditing(true);
    } else {
      toggleCollapsed();
    }
  }, [itemModel, toggleCollapsed]);

  const handleBlur = useCallback(
    async (e: React.FocusEvent<HTMLInputElement>) => {
      await handleSubmitNameEdit(e.currentTarget);
    },
    [handleSubmitNameEdit],
  );

  const handleSelect = useCallback(async () => {
    onSelect(itemId);
  }, [onSelect, itemId]);
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
      const items = itemModel === 'folder' ? get(foldersAtom) : get(allRequestsAtom);
      return items.find((v) => v.id === itemId);
    });
  }, [itemId, itemModel]);

  const item = useAtomValue(itemAtom);

  if (item == null) {
    return null;
  }

  const opacitySubtle = 'opacity-80';

  const itemPrefix = item.model !== 'folder' && (
    <HttpMethodTag
      short
      request={item}
      className={classNames('text-xs', !(active || selected) && opacitySubtle)}
    />
  );

  return (
    <li ref={ref} draggable>
      <div className={classNames(className, 'block relative group/item pl-2 pb-0.5')}>
        {showContextMenu && (
          <SidebarItemContextMenu
            child={child}
            show={showContextMenu}
            close={handleCloseContextMenu}
          />
        )}
        <div
          onContextMenu={handleContextMenu}
          data-active={active}
          data-selected={selected}
          className={classNames(
            'w-full flex gap-1.5 items-center h-xs pl-[0.33rem] pr-1.5 rounded-md focus-visible:ring focus-visible:ring-border-focus outline-0',
            'text-text-subtle',
            editing && 'ring-1 focus-within:ring-focus',
            active && 'bg-surface-active !text-text',
            showContextMenu && '!text-text', // Show as "active" when the context menu is open
          )}
        >
          {itemModel === 'folder' && (
            <>
              <button onClick={toggleCollapsed} type="button" className="px-1.5 -mx-1.5 h-full">
                <Icon
                  size="sm"
                  icon={children ? 'chevron_right' : 'empty'}
                  className={classNames(
                    'transition-transform text-text-subtlest',
                    !collapsed && 'transform rotate-90',
                  )}
                />
              </button>
              <Icon icon="folder" />
            </>
          )}
          <button
            // tabIndex={-1} // Will prevent drag-n-drop
            className="flex items-center gap-2 min-w-0 h-full w-full text-left"
            disabled={editing}
            onClick={handleSelect}
            onDoubleClick={handleDoubleClick}
          >
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
              <div className="truncate w-full">{itemName}</div>
            )}
          </button>
          {latestGrpcConnection ? (
            <div className="ml-auto">
              {latestGrpcConnection.state !== 'closed' && (
                <LoadingIcon size="sm" className="text-text-subtlest" />
              )}
            </div>
          ) : latestWebsocketConnection ? (
            <div className="ml-auto">
              {latestWebsocketConnection.state !== 'closed' && (
                <LoadingIcon size="sm" className="text-text-subtlest" />
              )}
            </div>
          ) : latestHttpResponse ? (
            <div className="ml-auto">
              {latestHttpResponse.state !== 'closed' ? (
                <LoadingIcon size="sm" className="text-text-subtlest" />
              ) : (
                <HttpStatusTag
                  short
                  className={classNames('text-xs', !(active || selected) && opacitySubtle)}
                  response={latestHttpResponse}
                />
              )}
            </div>
          ) : null}
        </div>
      </div>
      {collapsed ? null : children}
    </li>
  );
});
