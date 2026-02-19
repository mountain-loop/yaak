import type { Environment, Workspace } from '@yaakapp-internal/models';
import { duplicateModel, patchModel } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createSubEnvironmentAndActivate } from '../commands/createEnvironment';
import { activeWorkspaceAtom, activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import {
  environmentsBreakdownAtom,
  useEnvironmentsBreakdown,
} from '../hooks/useEnvironmentsBreakdown';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { jotaiStore } from '../lib/jotai';
import { isBaseEnvironment, isSubEnvironment } from '../lib/model_util';
import { resolvedModelName } from '../lib/resolvedModelName';
import { showColorPicker } from '../lib/showColorPicker';
import { Banner } from './core/Banner';
import type { ContextMenuProps, DropdownItem } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { IconTooltip } from './core/IconTooltip';
import { InlineCode } from './core/InlineCode';
import type { PairEditorHandle } from './core/PairEditor';
import { SplitLayout } from './core/SplitLayout';
import type { TreeNode } from './core/tree/common';
import type { TreeHandle, TreeProps } from './core/tree/Tree';
import { Tree } from './core/tree/Tree';
import { EnvironmentColorIndicator } from './EnvironmentColorIndicator';
import { EnvironmentEditor } from './EnvironmentEditor';
import { EnvironmentSharableTooltip } from './EnvironmentSharableTooltip';

interface Props {
  initialEnvironmentId: string | null;
  setRef?: (ref: PairEditorHandle | null) => void;
}

type TreeModel = Environment | Workspace;

export function EnvironmentEditDialog({ initialEnvironmentId, setRef }: Props) {
  const { allEnvironments, baseEnvironment, baseEnvironments } = useEnvironmentsBreakdown();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(
    initialEnvironmentId ?? null,
  );

  const selectedEnvironment =
    selectedEnvironmentId != null
      ? allEnvironments.find((e) => e.id === selectedEnvironmentId)
      : baseEnvironment;

  return (
    <SplitLayout
      name="env_editor"
      defaultRatio={0.75}
      layout="horizontal"
      className="gap-0"
      resizeHandleClassName="-translate-x-[1px]"
      firstSlot={() => (
        <EnvironmentEditDialogSidebar
          selectedEnvironmentId={selectedEnvironment?.id ?? null}
          setSelectedEnvironmentId={setSelectedEnvironmentId}
        />
      )}
      secondSlot={() => (
        <div className="grid grid-rows-[auto_minmax(0,1fr)]">
          {baseEnvironments.length > 1 ? (
            <div className="p-3">
              <Banner color="notice">
                There are multiple base environments for this workspace. Please delete the
                environments you no longer need.
              </Banner>
            </div>
          ) : (
            <span />
          )}
          {selectedEnvironment == null ? (
            <div className="p-3 mt-10">
              <Banner color="danger">
                Failed to find selected environment <InlineCode>{selectedEnvironmentId}</InlineCode>
              </Banner>
            </div>
          ) : (
            <EnvironmentEditor
              key={selectedEnvironment.id}
              setRef={setRef}
              className="pl-4 pt-3"
              environment={selectedEnvironment}
            />
          )}
        </div>
      )}
    />
  );
}

const sharableTooltip = (
  <IconTooltip
    tabIndex={-1}
    icon="eye"
    iconSize="sm"
    content="This environment will be included in Directory Sync and data exports"
  />
);

function EnvironmentEditDialogSidebar({
  selectedEnvironmentId,
  setSelectedEnvironmentId,
}: {
  selectedEnvironmentId: string | null;
  setSelectedEnvironmentId: (id: string | null) => void;
}) {
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom) ?? '';
  const treeId = `environment.${activeWorkspaceId}.sidebar`;
  const treeRef = useRef<TreeHandle>(null);
  const { baseEnvironment, baseEnvironments } = useEnvironmentsBreakdown();

  // biome-ignore lint/correctness/useExhaustiveDependencies: none
  useLayoutEffect(() => {
    if (selectedEnvironmentId == null) return;
    treeRef.current?.selectItem(selectedEnvironmentId);
    treeRef.current?.focus();
  }, []);

  const handleDeleteEnvironment = useCallback(
    async (environment: Environment) => {
      await deleteModelWithConfirm(environment);
      if (selectedEnvironmentId === environment.id) {
        setSelectedEnvironmentId(baseEnvironment?.id ?? null);
      }
    },
    [baseEnvironment?.id, selectedEnvironmentId, setSelectedEnvironmentId],
  );

  const actions = useMemo(() => {
    const enable = () => treeRef.current?.hasFocus() ?? false;

    const actions = {
      'sidebar.selected.rename': {
        enable,
        allowDefault: true,
        priority: 100,
        cb: async (items: TreeModel[]) => {
          const item = items[0];
          if (items.length === 1 && item != null) {
            treeRef.current?.renameItem(item.id);
          }
        },
      },
      'sidebar.selected.delete': {
        priority: 100,
        enable,
        cb: (items: TreeModel[]) => deleteModelWithConfirm(items),
      },
      'sidebar.selected.duplicate': {
        priority: 100,
        enable,
        cb: async (items: TreeModel[]) => {
          if (items.length === 1 && items[0]) {
            const item = items[0];
            const newId = await duplicateModel(item);
            setSelectedEnvironmentId(newId);
          } else {
            await Promise.all(items.map(duplicateModel));
          }
        },
      },
    } as const;
    return actions;
  }, [setSelectedEnvironmentId]);

  const hotkeys = useMemo<TreeProps<TreeModel>['hotkeys']>(() => ({ actions }), [actions]);

  const getContextMenu = useCallback(
    (items: TreeModel[]): ContextMenuProps['items'] => {
      const environment = items[0];
      const addEnvironmentItem: DropdownItem = {
        label: 'Create Sub Environment',
        leftSlot: <Icon icon="plus" />,
        onSelect: async () => {
          await createSubEnvironment();
        },
      };

      if (environment == null || environment.model !== 'environment') {
        return [addEnvironmentItem];
      }

      const singleEnvironment = items.length === 1;
      const canDeleteEnvironment =
        isSubEnvironment(environment) ||
        (isBaseEnvironment(environment) && baseEnvironments.length > 1);

      const menuItems: DropdownItem[] = [
        {
          label: 'Rename',
          leftSlot: <Icon icon="pencil" />,
          hidden: isBaseEnvironment(environment) || !singleEnvironment,
          hotKeyAction: 'sidebar.selected.rename',
          hotKeyLabelOnly: true,
          onSelect: async () => {
            // Not sure why this is needed, but without it the
            // edit input blurs immediately after opening.
            requestAnimationFrame(() => {
              actions['sidebar.selected.rename'].cb(items);
            });
          },
        },
        {
          label: 'Duplicate',
          leftSlot: <Icon icon="copy" />,
          hidden: isBaseEnvironment(environment),
          hotKeyAction: 'sidebar.selected.duplicate',
          hotKeyLabelOnly: true,
          onSelect: () => actions['sidebar.selected.duplicate'].cb(items),
        },
        {
          label: environment.color ? 'Change Color' : 'Assign Color',
          leftSlot: <Icon icon="palette" />,
          hidden: isBaseEnvironment(environment) || !singleEnvironment,
          onSelect: async () => showColorPicker(environment),
        },
        {
          label: `Make ${environment.public ? 'Private' : 'Sharable'}`,
          leftSlot: <Icon icon={environment.public ? 'eye_closed' : 'eye'} />,
          rightSlot: <EnvironmentSharableTooltip />,
          hidden: items.length > 1,
          onSelect: async () => {
            await patchModel(environment, { public: !environment.public });
          },
        },
        {
          color: 'danger',
          label: 'Delete',
          hotKeyAction: 'sidebar.selected.delete',
          hotKeyLabelOnly: true,
          hidden: !canDeleteEnvironment,
          leftSlot: <Icon icon="trash" />,
          onSelect: () => handleDeleteEnvironment(environment),
        },
      ];

      // Add sub environment to base environment
      if (isBaseEnvironment(environment) && singleEnvironment) {
        menuItems.push({ type: 'separator' });
        menuItems.push(addEnvironmentItem);
      }

      return menuItems;
    },
    [actions, baseEnvironments.length, handleDeleteEnvironment],
  );

  const handleDragEnd = useCallback(async function handleDragEnd({
    items,
    children,
    insertAt,
  }: {
    items: TreeModel[];
    children: TreeModel[];
    insertAt: number;
  }) {
    const prev = children[insertAt - 1] as Exclude<TreeModel, Workspace>;
    const next = children[insertAt] as Exclude<TreeModel, Workspace>;

    const beforePriority = prev?.sortPriority ?? 0;
    const afterPriority = next?.sortPriority ?? 0;
    const shouldUpdateAll = afterPriority - beforePriority < 1;

    try {
      if (shouldUpdateAll) {
        // Add items to children at insertAt
        children.splice(insertAt, 0, ...items);
        await Promise.all(children.map((m, i) => patchModel(m, { sortPriority: i * 1000 })));
      } else {
        const range = afterPriority - beforePriority;
        const increment = range / (items.length + 2);
        await Promise.all(
          items.map((m, i) => {
            const sortPriority = beforePriority + (i + 1) * increment;
            // Spread item sortPriority out over before/after range
            return patchModel(m, { sortPriority });
          }),
        );
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleActivate = useCallback(
    (item: TreeModel) => {
      setSelectedEnvironmentId(item.id);
    },
    [setSelectedEnvironmentId],
  );

  const tree = useAtomValue(treeAtom);
  return (
    <aside className="x-theme-sidebar h-full w-full min-w-0 grid overflow-y-auto border-r border-border-subtle ">
      {tree != null && (
        <div className="pt-2">
          <Tree
            ref={treeRef}
            treeId={treeId}
            className="px-2 pb-10"
            hotkeys={hotkeys}
            root={tree}
            getContextMenu={getContextMenu}
            onDragEnd={handleDragEnd}
            getItemKey={(i) => `${i.id}::${i.name}`}
            ItemLeftSlotInner={ItemLeftSlotInner}
            ItemRightSlot={ItemRightSlot}
            ItemInner={ItemInner}
            onActivate={handleActivate}
            getEditOptions={getEditOptions}
          />
        </div>
      )}
    </aside>
  );
}

const treeAtom = atom<TreeNode<TreeModel> | null>((get) => {
  const activeWorkspace = get(activeWorkspaceAtom);
  const { baseEnvironment, baseEnvironments, subEnvironments } = get(environmentsBreakdownAtom);
  if (activeWorkspace == null || baseEnvironment == null) return null;

  const root: TreeNode<TreeModel> = {
    item: activeWorkspace,
    parent: null,
    children: [],
    depth: 0,
  };

  for (const item of baseEnvironments) {
    root.children?.push({
      item,
      parent: root,
      depth: 0,
      draggable: false,
    });
  }

  const parent = root.children?.[0];
  if (baseEnvironments.length <= 1 && parent != null) {
    parent.children = subEnvironments.map((item) => ({
      item,
      parent,
      depth: 1,
      localDrag: true,
    }));
  }

  return root;
});

function ItemLeftSlotInner({ item }: { item: TreeModel }) {
  const { baseEnvironments } = useEnvironmentsBreakdown();
  return baseEnvironments.length > 1 ? (
    <Icon icon="alert_triangle" color="notice" />
  ) : (
    item.model === 'environment' && item.color && <EnvironmentColorIndicator environment={item} />
  );
}

function ItemRightSlot({ item }: { item: TreeModel }) {
  const { baseEnvironments } = useEnvironmentsBreakdown();
  return (
    <>
      {item.model === 'environment' && baseEnvironments.length <= 1 && isBaseEnvironment(item) && (
        <IconButton
          size="sm"
          color="custom"
          iconSize="sm"
          icon="plus_circle"
          className="opacity-50 hover:opacity-100"
          title="Add Sub-Environment"
          onClick={createSubEnvironment}
        />
      )}
    </>
  );
}

function ItemInner({ item }: { item: TreeModel }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] w-full items-center">
      {item.model === 'environment' && item.public ? (
        <div className="mr-2 flex items-center">{sharableTooltip}</div>
      ) : (
        <span aria-hidden />
      )}
      <div className="truncate min-w-0 text-left">{resolvedModelName(item)}</div>
    </div>
  );
}

async function createSubEnvironment() {
  const { baseEnvironment } = jotaiStore.get(environmentsBreakdownAtom);
  if (baseEnvironment == null) return;
  const id = await createSubEnvironmentAndActivate.mutateAsync(baseEnvironment);
  return id;
}

function getEditOptions(item: TreeModel) {
  const options: ReturnType<NonNullable<TreeProps<TreeModel>['getEditOptions']>> = {
    defaultValue: item.name,
    placeholder: 'Name',
    async onChange(item, name) {
      await patchModel(item, { name });
    },
  };
  return options;
}
