import type { Environment } from '@yaakapp-internal/models';
import { duplicateModel, patchModel } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { ReactNode } from 'react';
import React, { useCallback, useState } from 'react';
import { createSubEnvironmentAndActivate } from '../commands/createEnvironment';
import { useEnvironmentsBreakdown } from '../hooks/useEnvironmentsBreakdown';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { isBaseEnvironment } from '../lib/model_util';
import { showPrompt } from '../lib/prompt';
import { resolvedModelName } from '../lib/resolvedModelName';
import { showColorPicker } from '../lib/showColorPicker';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import type { DropdownItem } from './core/Dropdown';
import { ContextMenu } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { IconTooltip } from './core/IconTooltip';
import { InlineCode } from './core/InlineCode';
import { Separator } from './core/Separator';
import { SplitLayout } from './core/SplitLayout';
import { EnvironmentColorIndicator } from './EnvironmentColorIndicator';
import { EnvironmentEditor } from './EnvironmentEditor';
import { EnvironmentSharableTooltip } from './EnvironmentSharableTooltip';

interface Props {
  initialEnvironment: Environment | null;
}

export const EnvironmentEditDialog = function ({ initialEnvironment }: Props) {
  const { baseEnvironment, otherBaseEnvironments, subEnvironments, allEnvironments } =
    useEnvironmentsBreakdown();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(
    initialEnvironment?.id ?? null,
  );

  const selectedEnvironment =
    selectedEnvironmentId != null
      ? allEnvironments.find((e) => e.id === selectedEnvironmentId)
      : baseEnvironment;

  const handleCreateEnvironment = async () => {
    if (baseEnvironment == null) return;
    const id = await createSubEnvironmentAndActivate.mutateAsync(baseEnvironment);
    if (id != null) setSelectedEnvironmentId(id);
  };

  const handleDuplicateEnvironment = useCallback(async (environment: Environment) => {
    const name = await showPrompt({
      id: 'duplicate-environment',
      title: 'Duplicate Environment',
      label: 'Name',
      defaultValue: environment.name,
    });
    if (name) {
      const newId = await duplicateModel({ ...environment, name, public: false });
      setSelectedEnvironmentId(newId);
    }
  }, []);

  const handleDeleteEnvironment = useCallback(
    async (environment: Environment) => {
      await deleteModelWithConfirm(environment);
      if (selectedEnvironmentId === environment.id) {
        setSelectedEnvironmentId(baseEnvironment?.id ?? null);
      }
    },
    [baseEnvironment?.id, selectedEnvironmentId],
  );

  if (baseEnvironment == null) {
    return null;
  }

  return (
    <SplitLayout
      name="env_editor"
      defaultRatio={0.75}
      layout="horizontal"
      className="gap-0"
      firstSlot={() => (
        <aside className="w-full min-w-0 pt-2">
          <div className="min-w-0 h-full overflow-y-auto pt-1">
            {[baseEnvironment, ...otherBaseEnvironments].map((e) => (
              <EnvironmentDialogSidebarButton
                key={e.id}
                active={selectedEnvironment?.id == e.id}
                onClick={() => setSelectedEnvironmentId(e.id)}
                environment={e}
                duplicateEnvironment={handleDuplicateEnvironment}
                // Allow deleting the base environment if there are multiples
                deleteEnvironment={
                  otherBaseEnvironments.length > 0 ? handleDeleteEnvironment : null
                }
                rightSlot={e.public && sharableTooltip}
                outerRightSlot={
                  <IconButton
                    size="sm"
                    iconSize="md"
                    title="Add sub environment"
                    icon="plus_circle"
                    iconClassName="text-text-subtlest group-hover:text-text-subtle"
                    className="group mr-0.5"
                    onClick={handleCreateEnvironment}
                  />
                }
              >
                {resolvedModelName(e)}
              </EnvironmentDialogSidebarButton>
            ))}
            {subEnvironments.length > 0 && (
              <div className="px-2">
                <Separator className="my-3" />
              </div>
            )}
            {subEnvironments.map((e) => (
              <EnvironmentDialogSidebarButton
                key={e.id}
                active={selectedEnvironment?.id === e.id}
                environment={e}
                onClick={() => setSelectedEnvironmentId(e.id)}
                rightSlot={e.public && sharableTooltip}
                duplicateEnvironment={handleDuplicateEnvironment}
                deleteEnvironment={handleDeleteEnvironment}
              >
                {e.name}
              </EnvironmentDialogSidebarButton>
            ))}
          </div>
        </aside>
      )}
      secondSlot={() =>
        selectedEnvironment == null ? (
          <div className="p-3 mt-10">
            <Banner color="danger">
              Failed to find selected environment <InlineCode>{selectedEnvironmentId}</InlineCode>
            </Banner>
          </div>
        ) : (
          <EnvironmentEditor
            className="pl-4 pt-3 border-l border-border-subtle"
            environment={selectedEnvironment}
          />
        )
      }
    />
  );
};

function EnvironmentDialogSidebarButton({
  children,
  className,
  active,
  onClick,
  deleteEnvironment,
  rightSlot,
  outerRightSlot,
  duplicateEnvironment,
  environment,
}: {
  className?: string;
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  rightSlot?: ReactNode;
  outerRightSlot?: ReactNode;
  environment: Environment;
  deleteEnvironment: ((environment: Environment) => void) | null;
  duplicateEnvironment: ((environment: Environment) => void) | null;
}) {
  const [showContextMenu, setShowContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setShowContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <div
        className={classNames(
          className,
          'w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5',
          'px-2', // Padding to show the focus border
        )}
      >
        <Button
          color="custom"
          size="xs"
          className={classNames(
            'w-full',
            active ? 'text bg-surface-active' : 'text-text-subtle hover:text',
          )}
          justify="start"
          onClick={onClick}
          onContextMenu={handleContextMenu}
          rightSlot={rightSlot}
        >
          <EnvironmentColorIndicator environment={environment} />
          {children}
        </Button>
        {outerRightSlot}
      </div>
      <ContextMenu
        triggerPosition={showContextMenu}
        onClose={() => setShowContextMenu(null)}
        items={[
          {
            label: 'Rename',
            leftSlot: <Icon icon="pencil" />,
            hidden: isBaseEnvironment(environment),
            onSelect: async () => {
              const name = await showPrompt({
                id: 'rename-environment',
                title: 'Rename Environment',
                description: (
                  <>
                    Enter a new name for <InlineCode>{environment.name}</InlineCode>
                  </>
                ),
                label: 'Name',
                confirmText: 'Save',
                placeholder: 'New Name',
                defaultValue: environment.name,
              });
              if (name == null) return;
              await patchModel(environment, { name });
            },
          },
          {
            label: 'Duplicate',
            leftSlot: <Icon icon="copy" />,
            hidden: isBaseEnvironment(environment),
            onSelect: () => {
              duplicateEnvironment?.(environment);
            },
          },
          {
            label: environment.color ? 'Change Color' : 'Assign Color',
            leftSlot: <Icon icon="palette" />,
            hidden: isBaseEnvironment(environment),
            onSelect: async () => showColorPicker(environment),
          },
          {
            label: `Make ${environment.public ? 'Private' : 'Sharable'}`,
            leftSlot: <Icon icon={environment.public ? 'eye_closed' : 'eye'} />,
            rightSlot: <EnvironmentSharableTooltip />,
            onSelect: async () => {
              await patchModel(environment, { public: !environment.public });
            },
          },
          ...((deleteEnvironment
            ? [
                {
                  color: 'danger',
                  label: 'Delete',
                  leftSlot: <Icon icon="trash" />,
                  onSelect: () => {
                    deleteEnvironment(environment);
                  },
                },
              ]
            : []) as DropdownItem[]),
        ]}
      />
    </>
  );
}

const sharableTooltip = (
  <IconTooltip
    icon="eye"
    content="This environment will be included in Directory Sync and data exports"
  />
);
