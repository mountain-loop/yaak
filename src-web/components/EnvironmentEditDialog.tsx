import type { Environment } from '@yaakapp-internal/models';
import type { GenericCompletionOption } from '@yaakapp-internal/plugins';
import classNames from 'classnames';
import type { ReactNode } from 'react';
import React, { useCallback, useMemo, useState } from 'react';
import { useCreateEnvironment } from '../hooks/useCreateEnvironment';
import { useDeleteEnvironment } from '../hooks/useDeleteEnvironment';
import { useEnvironments } from '../hooks/useEnvironments';
import { useKeyValue } from '../hooks/useKeyValue';
import { useUpdateEnvironment } from '../hooks/useUpdateEnvironment';
import { showPrompt } from '../lib/prompt';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { ContextMenu } from './core/Dropdown';
import type { GenericCompletionConfig } from './core/Editor/genericCompletion';
import { Heading } from './core/Heading';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import type { PairEditorProps } from './core/PairEditor';
import { PairOrBulkEditor } from './core/PairOrBulkEditor';
import { Separator } from './core/Separator';
import { SplitLayout } from './core/SplitLayout';
import { HStack, VStack } from './core/Stacks';

interface Props {
  initialEnvironment: Environment | null;
}

export const EnvironmentEditDialog = function ({ initialEnvironment }: Props) {
  const createEnvironment = useCreateEnvironment();
  const { baseEnvironment, subEnvironments, allEnvironments } = useEnvironments();

  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(
    initialEnvironment?.id ?? null,
  );

  const selectedEnvironment =
    selectedEnvironmentId != null
      ? allEnvironments.find((e) => e.id === selectedEnvironmentId)
      : baseEnvironment;

  const handleCreateEnvironment = async () => {
    if (baseEnvironment == null) return;
    const e = await createEnvironment.mutateAsync(baseEnvironment);
    if (e == null) return;
    setSelectedEnvironmentId(e.id);
  };

  return (
    <SplitLayout
      name="env_editor"
      defaultRatio={0.75}
      layout="horizontal"
      className="gap-0"
      firstSlot={() => (
        <aside className="w-full min-w-0 pt-2">
          <div className="min-w-0 h-full overflow-y-auto pt-1">
            <SidebarButton
              active={selectedEnvironment?.id == baseEnvironment?.id}
              onClick={() => setSelectedEnvironmentId(null)}
              environment={null}
              rightSlot={
                <IconButton
                  size="sm"
                  iconSize="md"
                  title="Add sub environment"
                  icon="plus_circle"
                  iconClassName="text-text-subtlest group-hover:text-text-subtle"
                  className="group"
                  onClick={handleCreateEnvironment}
                />
              }
            >
              {baseEnvironment?.name}
            </SidebarButton>
            {subEnvironments.length > 0 && (
              <div className="px-2">
                <Separator className="my-3"></Separator>
              </div>
            )}
            {subEnvironments.map((e) => (
              <SidebarButton
                key={e.id}
                active={selectedEnvironment?.id === e.id}
                environment={e}
                onClick={() => setSelectedEnvironmentId(e.id)}
                onDelete={() => {
                  if (e.id === selectedEnvironmentId) {
                    setSelectedEnvironmentId(null);
                  }
                }}
              >
                {e.name}
              </SidebarButton>
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
            className="pt-2 border-l border-border-subtle"
            environment={selectedEnvironment}
          />
        )
      }
    />
  );
};

const EnvironmentEditor = function ({
  environment: activeEnvironment,
  className,
}: {
  environment: Environment;
  className?: string;
}) {
  const valueVisibility = useKeyValue<boolean>({
    namespace: 'global',
    key: 'environmentValueVisibility',
    fallback: true,
  });
  const { allEnvironments } = useEnvironments();
  const updateEnvironment = useUpdateEnvironment(activeEnvironment?.id ?? null);
  const handleChange = useCallback<PairEditorProps['onChange']>(
    (variables) => updateEnvironment.mutate({ variables }),
    [updateEnvironment],
  );

  // Gather a list of env names from other environments, to help the user get them aligned
  const nameAutocomplete = useMemo<GenericCompletionConfig>(() => {
    const options: GenericCompletionOption[] = [];
    const isBaseEnv = activeEnvironment.environmentId == null;
    if (isBaseEnv) {
      return { options };
    }

    const allVariables = allEnvironments.flatMap((e) => e?.variables);
    const allVariableNames = new Set(allVariables.map((v) => v?.name));
    for (const name of allVariableNames) {
      const containingEnvs = allEnvironments.filter((e) =>
        e.variables.some((v) => v.name === name),
      );
      const isAlreadyInActive = containingEnvs.find((e) => e.id === activeEnvironment.id);
      if (isAlreadyInActive) continue;
      options.push({
        label: name,
        type: 'constant',
        detail: containingEnvs.map((e) => e.name).join(', '),
      });
    }
    return { options };
  }, [activeEnvironment.environmentId, activeEnvironment.id, allEnvironments]);

  const validateName = useCallback((name: string) => {
    // Empty just means the variable doesn't have a name yet, and is unusable
    if (name === '') return true;
    return name.match(/^[a-z_][a-z0-9_-]*$/i) != null;
  }, []);

  return (
    <VStack space={4} className={classNames(className, 'pl-4')}>
      <HStack space={2} className="justify-between">
        <Heading className="w-full flex items-center gap-1">
          <div>{activeEnvironment?.name}</div>
          <IconButton
            size="sm"
            icon={valueVisibility.value ? 'eye' : 'eye_closed'}
            title={valueVisibility.value ? 'Hide Values' : 'Reveal Values'}
            onClick={() => {
              return valueVisibility.set((v) => !v);
            }}
          />
        </Heading>
      </HStack>
      <div className="h-full pr-2 pb-2">
        <PairOrBulkEditor
          allowMultilineValues
          preferenceName="environment"
          nameAutocomplete={nameAutocomplete}
          namePlaceholder="VAR_NAME"
          nameValidate={validateName}
          valueType={valueVisibility.value ? 'text' : 'password'}
          valueAutocompleteVariables
          valueAutocompleteFunctions
          forceUpdateKey={activeEnvironment.id}
          pairs={activeEnvironment.variables}
          onChange={handleChange}
          stateKey={`environment.${activeEnvironment.id}`}
        />
      </div>
    </VStack>
  );
};

function SidebarButton({
  children,
  className,
  active,
  onClick,
  onDelete,
  rightSlot,
  environment,
}: {
  className?: string;
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
  rightSlot?: ReactNode;
  environment: Environment | null;
}) {
  const updateEnvironment = useUpdateEnvironment(environment?.id ?? null);
  const deleteEnvironment = useDeleteEnvironment(environment);
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
        >
          {children}
        </Button>
        {rightSlot}
      </div>
      {environment != null && (
        <ContextMenu
          triggerPosition={showContextMenu}
          onClose={() => setShowContextMenu(null)}
          items={[
            {
              label: 'Rename',
              leftSlot: <Icon icon="pencil" size="sm" />,
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
                updateEnvironment.mutate({ name });
              },
            },
            {
              color: 'danger',
              label: 'Delete',
              leftSlot: <Icon icon="trash" size="sm" />,
              onSelect: () => {
                deleteEnvironment.mutate(undefined, {
                  onSuccess: onDelete,
                });
              },
            },
          ]}
        />
      )}
    </>
  );
}
