import type { AnyModel, GrpcConnection, HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { ReactNode } from 'react';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { XYCoord } from 'react-dnd';
import { useDrag, useDrop } from 'react-dnd';

import { useActiveRequest } from '../hooks/useActiveRequest';
import { useCreateDropdownItems } from '../hooks/useCreateDropdownItems';
import { useDeleteFolder } from '../hooks/useDeleteFolder';
import { useDeleteRequest } from '../hooks/useDeleteRequest';
import { useDuplicateFolder } from '../hooks/useDuplicateFolder';
import { useDuplicateGrpcRequest } from '../hooks/useDuplicateGrpcRequest';
import { useDuplicateHttpRequest } from '../hooks/useDuplicateHttpRequest';
import { useMoveToWorkspace } from '../hooks/useMoveToWorkspace';
import { useRenameRequest } from '../hooks/useRenameRequest';
import { useScrollIntoView } from '../hooks/useScrollIntoView';
import { useSendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { useSendManyRequests } from '../hooks/useSendManyRequests';
import { useUpdateAnyGrpcRequest } from '../hooks/useUpdateAnyGrpcRequest';
import { useUpdateAnyHttpRequest } from '../hooks/useUpdateAnyHttpRequest';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { isResponseLoading } from '../lib/model_util';
import { getHttpRequest } from '../lib/store';
import type { DropdownItem } from './core/Dropdown';
import { ContextMenu } from './core/Dropdown';
import { HttpMethodTag } from './core/HttpMethodTag';
import { Icon } from './core/Icon';
import { StatusTag } from './core/StatusTag';
import { useDialog } from './DialogContext';
import { FolderSettingsDialog } from './FolderSettingsDialog';
import type { SidebarTreeNode } from './Sidebar';
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
  useProminentStyles?: boolean;
  selected: boolean;
  onMove: (id: string, side: 'above' | 'below') => void;
  onEnd: (id: string) => void;
  onDragStart: (id: string) => void;
  children?: ReactNode;
  child: SidebarTreeNode;
  latestHttpResponse: HttpResponse | null;
  latestGrpcConnection: GrpcConnection | null;
} & Pick<SidebarItemsProps, 'isCollapsed' | 'onSelect' | 'httpRequestActions'>;

type DragItem = {
  id: string;
  itemName: string;
};

function SidebarItem_({
  itemName,
  itemId,
  itemModel,
  child,
  onMove,
  onEnd,
  onDragStart,
  onSelect,
  isCollapsed,
  className,
  selected,
  itemFallbackName,
  useProminentStyles,
  latestHttpResponse,
  latestGrpcConnection,
  httpRequestActions,
  children,
}: SidebarItemProps) {
  const ref = useRef<HTMLLIElement>(null);

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

  const dialog = useDialog();
  const activeRequest = useActiveRequest();
  const deleteFolder = useDeleteFolder(itemId);
  const deleteRequest = useDeleteRequest(itemId);
  const renameRequest = useRenameRequest(itemId);
  const duplicateFolder = useDuplicateFolder(itemId);
  const duplicateHttpRequest = useDuplicateHttpRequest({ id: itemId, navigateAfter: true });
  const duplicateGrpcRequest = useDuplicateGrpcRequest({ id: itemId, navigateAfter: true });
  const sendRequest = useSendAnyHttpRequest();
  const moveToWorkspace = useMoveToWorkspace(itemId);
  const sendManyRequests = useSendManyRequests();
  const updateHttpRequest = useUpdateAnyHttpRequest();
  const workspaces = useWorkspaces();
  const updateGrpcRequest = useUpdateAnyGrpcRequest();
  const [editing, setEditing] = useState<boolean>(false);
  const isActive = activeRequest?.id === itemId;
  const createDropdownItems = useCreateDropdownItems({ folderId: itemId });

  useScrollIntoView(ref.current, isActive);

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

  const handleSelect = useCallback(() => onSelect(itemId), [onSelect, itemId]);
  const [showContextMenu, setShowContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setShowContextMenu({ x: e.clientX, y: e.clientY });
  }, []);
  //
  const items = useMemo<DropdownItem[]>(() => {
    if (itemModel === 'folder') {
      return [
        {
          key: 'send-all',
          label: 'Send All',
          leftSlot: <Icon icon="send_horizontal" />,
          onSelect: () => sendManyRequests.mutate(child.children.map((c) => c.item.id)),
        },
        {
          key: 'folder-settings',
          label: 'Settings',
          leftSlot: <Icon icon="settings" />,
          onSelect: () =>
            dialog.show({
              id: 'folder-settings',
              title: 'Folder Settings',
              size: 'md',
              render: () => <FolderSettingsDialog folderId={itemId} />,
            }),
        },
        {
          key: 'duplicateFolder',
          label: 'Duplicate',
          leftSlot: <Icon icon="copy" />,
          onSelect: () => duplicateFolder.mutate(),
        },
        {
          key: 'delete-folder',
          label: 'Delete',
          variant: 'danger',
          leftSlot: <Icon icon="trash" />,
          onSelect: () => deleteFolder.mutate(),
        },
        { type: 'separator' },
        ...createDropdownItems,
      ];
    } else {
      const requestItems: DropdownItem[] =
        itemModel === 'http_request'
          ? [
              {
                key: 'send-request',
                label: 'Send',
                hotKeyAction: 'http_request.send',
                hotKeyLabelOnly: true, // Already bound in URL bar
                leftSlot: <Icon icon="send_horizontal" />,
                onSelect: () => sendRequest.mutate(itemId),
              },
              ...httpRequestActions.map((a) => ({
                key: a.key,
                label: a.label,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                leftSlot: <Icon icon={(a.icon as any) ?? 'empty'} />,
                onSelect: async () => {
                  const request = await getHttpRequest(itemId);
                  if (request != null) await a.call(request);
                },
              })),
              { type: 'separator' },
            ]
          : [];
      return [
        ...requestItems,
        {
          key: 'rename-request',
          label: 'Rename',
          leftSlot: <Icon icon="pencil" />,
          onSelect: renameRequest.mutate,
        },
        {
          key: 'duplicate-request',
          label: 'Duplicate',
          hotKeyAction: 'http_request.duplicate',
          hotKeyLabelOnly: true, // Would trigger for every request (bad)
          leftSlot: <Icon icon="copy" />,
          onSelect: () =>
            itemModel === 'http_request'
              ? duplicateHttpRequest.mutate()
              : duplicateGrpcRequest.mutate(),
        },
        {
          key: 'move-workspace',
          label: 'Move',
          leftSlot: <Icon icon="arrow_right_circle" />,
          hidden: workspaces.length <= 1,
          onSelect: moveToWorkspace.mutate,
        },
        {
          key: 'delete-request',
          variant: 'danger',
          label: 'Delete',
          leftSlot: <Icon icon="trash" />,
          onSelect: () => deleteRequest.mutate(),
        },
      ];
    }
  }, [
    child.children,
    createDropdownItems,
    deleteFolder,
    deleteRequest,
    dialog,
    duplicateFolder,
    duplicateGrpcRequest,
    duplicateHttpRequest,
    httpRequestActions,
    itemId,
    itemModel,
    moveToWorkspace.mutate,
    renameRequest.mutate,
    sendManyRequests,
    sendRequest,
    workspaces.length,
  ]);

  const itemPrefix = (child.item.model === 'http_request' ||
    child.item.model === 'grpc_request') && (
    <HttpMethodTag
      request={child.item}
      className={classNames(!(isActive || selected) && 'text-text-subtlest')}
    />
  );

  return (
    <li ref={ref} draggable>
      <div className={classNames(className, 'block relative group/item px-1.5 pb-0.5')}>
        <ContextMenu
          triggerPosition={showContextMenu}
          items={items}
          onClose={handleCloseContextMenu}
        />
        <button
          // tabIndex={-1} // Will prevent drag-n-drop
          disabled={editing}
          onClick={handleSelect}
          onDoubleClick={handleStartEditing}
          onContextMenu={handleContextMenu}
          data-active={isActive}
          data-selected={selected}
          className={classNames(
            'w-full flex gap-1.5 items-center h-xs px-1.5 rounded-md focus-visible:ring focus-visible:ring-border-focus outline-0',
            editing && 'ring-1 focus-within:ring-focus',
            isActive && 'bg-surface-highlight text-text',
            !isActive && 'text-text-subtle group-hover/item:text-text',
            showContextMenu && '!text-text', // Show as "active" when context menu is open
            selected && useProminentStyles && '!bg-surface-active',
          )}
        >
          {itemModel === 'folder' && (
            <Icon
              size="sm"
              icon="chevron_right"
              className={classNames(
                'text-text-subtlest',
                'transition-transform',
                !isCollapsed(itemId) && 'transform rotate-90',
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
      {children}
    </li>
  );
}

export const SidebarItem = memo<SidebarItemProps>(SidebarItem_, (a, b) => {
  let different = false;
  for (const key of Object.keys(a) as (keyof SidebarItemProps)[]) {
    if (a[key] !== b[key]) {
      // console.log('DIFFERENT', key, a[key], b[key]);
      different = true;
    }
  }
  if (different) {
    // console.log('DIFFERENT -------------------');
  }
  return !different;
});
