import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { GrpcRequest, HttpRequest, WebsocketRequest } from "@yaakapp-internal/models";
import { computeSideForDragMove, DropMarker, Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { activeRequestIdAtom } from "../hooks/useActiveRequestId";
import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { allRequestsAtom } from "../hooks/useAllRequests";
import { useRequestTabsState } from "../hooks/useRequestTabs";
import {
  activateRequestTab,
  closeAllRequestTabs,
  closeOtherRequestTabs,
  closeRequestTab,
  closeRequestTabsToRight,
  pinRequestTab,
  reorderRequestTabs,
} from "../lib/requestTabs";
import { resolvedModelName } from "../lib/resolvedModelName";
import { CreateDropdown } from "./CreateDropdown";
import { ContextMenu } from "./core/Dropdown";
import type { DropdownItem } from "./core/Dropdown";
import { HttpMethodTag } from "./core/HttpMethodTag";
import { IconButton } from "./core/IconButton";

type RequestModel = HttpRequest | GrpcRequest | WebsocketRequest;

interface TabModel {
  request: RequestModel;
  isActive: boolean;
  isPreview: boolean;
}

export function RequestTabs() {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const activeRequestId = useAtomValue(activeRequestIdAtom);
  const allRequests = useAtomValue(allRequestsAtom);
  const { tabs: tabIds } = useRequestTabsState();

  const requestById = useMemo(() => {
    const map = new Map<string, RequestModel>();
    for (const r of allRequests) map.set(r.id, r);
    return map;
  }, [allRequests]);

  const tabs = useMemo<TabModel[]>(() => {
    const result: TabModel[] = [];
    for (const id of tabIds) {
      const request = requestById.get(id);
      if (request == null) continue;
      result.push({
        request,
        isActive: id === activeRequestId,
        isPreview: false,
      });
    }
    return result;
  }, [tabIds, requestById, activeRequestId]);

  // Local order for smooth drag-and-drop, synced from persisted state
  const [orderedTabs, setOrderedTabs] = useState<TabModel[]>(tabs);
  const [dragging, setDragging] = useState<TabModel | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  useEffect(() => setOrderedTabs(tabs), [tabs]);

  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      setDragging(orderedTabs.find((t) => t.request.id === e.active.id) ?? null);
    },
    [orderedTabs],
  );

  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const overId = e.over?.id as string | undefined;
      if (!overId) return setHoveredIndex(null);
      const side = computeSideForDragMove(overId, e, "horizontal");
      if (side === null) return setHoveredIndex(null);
      const overIndex = orderedTabs.findIndex((t) => t.request.id === overId);
      if (overIndex === -1) return setHoveredIndex(null);
      setHoveredIndex(overIndex + (side === "before" ? 0 : 1));
    },
    [orderedTabs],
  );

  const resetDrag = useCallback(() => {
    setDragging(null);
    setHoveredIndex(null);
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      resetDrag();
      if (workspaceId == null) return;
      const activeId = e.active.id as string | undefined;
      const overId = e.over?.id as string | undefined;
      if (!activeId || !overId || activeId === overId) return;

      const from = orderedTabs.findIndex((t) => t.request.id === activeId);
      const baseTo = orderedTabs.findIndex((t) => t.request.id === overId);
      const to = hoveredIndex ?? baseTo;
      if (from === -1 || to === -1 || from === to) return;

      const next = [...orderedTabs];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return;
      next.splice(to > from ? to - 1 : to, 0, moved);
      setOrderedTabs(next);
      void reorderRequestTabs(
        workspaceId,
        next.map((t) => t.request.id),
      );
    },
    [resetDrag, workspaceId, orderedTabs, hoveredIndex],
  );

  const contextMenuItems = useMemo<DropdownItem[]>(() => {
    if (menu == null || workspaceId == null) return [];
    const id = menu.id;
    const idx = tabIds.indexOf(id);
    const hasTabsToRight = idx >= 0 && idx < tabIds.length - 1;
    return [
      {
        label: "Close",
        leftSlot: <Icon icon="x" />,
        onSelect: () => closeRequestTab(workspaceId, id),
      },
      {
        label: "Close Others",
        leftSlot: <Icon icon="x" />,
        hidden: tabIds.length <= 1,
        onSelect: () => closeOtherRequestTabs(workspaceId, id),
      },
      {
        label: "Close to the Right",
        leftSlot: <Icon icon="x" />,
        hidden: !hasTabsToRight,
        onSelect: () => closeRequestTabsToRight(workspaceId, id),
      },
      {
        label: "Close All",
        leftSlot: <Icon icon="x" />,
        onSelect: () => closeAllRequestTabs(workspaceId),
      },
    ];
  }, [menu, workspaceId, tabIds]);

  if (tabIds.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-shrink-0 items-stretch bg-surface border-b border-border-subtle h-9 min-h-9">
      <div className="flex items-stretch overflow-x-auto hide-scrollbars">
        <DndContext
          autoScroll
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={resetDrag}
        >
          {orderedTabs.map((tab, i) => (
            <div key={tab.request.id} className="flex items-stretch">
              {hoveredIndex === i && <DropMarker orientation="vertical" />}
              <RequestTab
                tab={tab}
                workspaceId={workspaceId}
                isDragging={dragging?.request.id === tab.request.id}
                onContextMenu={(x, y) => setMenu({ x, y, id: tab.request.id })}
              />
            </div>
          ))}
          {hoveredIndex === orderedTabs.length && <DropMarker orientation="vertical" />}
          <DragOverlay dropAnimation={null}>
            {dragging && <RequestTab tab={dragging} workspaceId={workspaceId} overlay />}
          </DragOverlay>
        </DndContext>
      </div>
      <CreateDropdown hideFolder>
        <IconButton
          size="sm"
          icon="plus"
          title="New Request"
          className="flex-shrink-0 ml-0.5 my-auto text-text-subtle hover:text-text"
        />
      </CreateDropdown>
      {menu != null && (
        <ContextMenu
          triggerPosition={{ x: menu.x, y: menu.y }}
          items={contextMenuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface RequestTabProps {
  tab: TabModel;
  workspaceId: string | null;
  isDragging?: boolean;
  overlay?: boolean;
  onContextMenu?: (x: number, y: number) => void;
}

function RequestTab({ tab, workspaceId, isDragging, overlay, onContextMenu }: RequestTabProps) {
  const { request, isActive, isPreview } = tab;
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
  } = useDraggable({
    id: request.id,
    disabled: overlay,
    attributes: { tabIndex: -1 },
  });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: request.id, disabled: overlay });

  const setRef = useCallback(
    (n: HTMLDivElement | null) => {
      if (overlay) return;
      setDraggableRef(n);
      setDroppableRef(n);
    },
    [overlay, setDraggableRef, setDroppableRef],
  );

  const handleClick = useCallback(() => {
    if (!isActive) activateRequestTab(request.id);
  }, [isActive, request.id]);

  const handleDoubleClick = useCallback(() => {
    if (workspaceId != null && isPreview) void pinRequestTab(workspaceId, request.id);
  }, [workspaceId, isPreview, request.id]);

  const handleAuxClick = useCallback(
    (e: MouseEvent) => {
      // Middle-click closes the tab
      if (e.button === 1 && workspaceId != null) {
        e.preventDefault();
        void closeRequestTab(workspaceId, request.id);
      }
    },
    [workspaceId, request.id],
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      onContextMenu?.(e.clientX, e.clientY);
    },
    [onContextMenu],
  );

  const handleClose = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (workspaceId != null) void closeRequestTab(workspaceId, request.id);
    },
    [workspaceId, request.id],
  );

  return (
    <div
      ref={setRef}
      role="tab"
      aria-selected={isActive}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onAuxClick={handleAuxClick}
      onContextMenu={handleContextMenu}
      className={classNames(
        "group relative flex items-center gap-1.5 pl-3 pr-1.5 select-none cursor-default",
        "border-r border-border-subtle min-w-[8rem] max-w-[14rem]",
        isActive
          ? "bg-surface-active text-text"
          : "text-text-subtle hover:text-text hover:bg-surface-highlight",
        isDragging && "opacity-50",
        overlay && "opacity-90 border bg-surface-active rounded",
      )}
      {...(overlay ? {} : { ...attributes, ...listeners })}
    >
      {isActive && (
        <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-text-subtle" aria-hidden />
      )}
      <HttpMethodTag short request={request} className="text-xs flex-shrink-0" />
      <div className={classNames("truncate text-sm", isPreview && "italic")}>
        {resolvedModelName(request)}
      </div>
      <IconButton
        size="xs"
        icon="x"
        title="Close tab"
        tabIndex={-1}
        onClick={handleClose}
        className={classNames(
          "flex-shrink-0 ml-auto !w-5 !h-5 opacity-0 group-hover:opacity-70 hover:!opacity-100",
          isActive && "opacity-70",
        )}
      />
    </div>
  );
}
