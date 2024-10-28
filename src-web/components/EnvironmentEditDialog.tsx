import classNames from 'classnames';
import type { ReactNode } from 'react';
import React, { useCallback, useMemo, useState } from 'react';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useCreateEnvironment } from '../hooks/useCreateEnvironment';
import { useDeleteEnvironment } from '../hooks/useDeleteEnvironment';
import { useEnvironments } from '../hooks/useEnvironments';
import { useKeyValue } from '../hooks/useKeyValue';
import { usePrompt } from '../hooks/usePrompt';
import { useUpdateEnvironment } from '../hooks/useUpdateEnvironment';
import { useUpdateWorkspace } from '../hooks/useUpdateWorkspace';
import type { Environment, Workspace } from '@yaakapp-internal/models';
import { Button } from './core/Button';
import { ContextMenu } from './core/Dropdown';
import type {
  GenericCompletionConfig,
  GenericCompletionOption,
} from './core/Editor/genericCompletion';
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
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(
    initialEnvironment?.id ?? null,
  );
  const environments = useEnvironments();
  const createEnvironment = useCreateEnvironment();
  const activeWorkspace = useActiveWorkspace();

  const selectedEnvironment = useMemo(
    () => environments.find((e) => e.id === selectedEnvironmentId) ?? null,
    [environments, selectedEnvironmentId],
  );

  const handleCreateEnvironment = async () => {
    const e = await createEnvironment.mutateAsync();
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
              active={selectedEnvironment?.id == null}
              onClick={() => setSelectedEnvironmentId(null)}
              environment={null}
              rightSlot={
                <IconButton
                  size="sm"
                  iconSize="md"
                  color="custom"
                  title="Add sub environment"
                  icon="plus_circle"
                  iconClassName="text-text-subtlest group-hover:text-text-subtle"
                  className="group"
                  onClick={handleCreateEnvironment}
                />
              }
            >
              Global Variables
            </SidebarButton>
            {environments.length > 0 && (
              <div className="px-2">
                <Separator className="my-3"></Separator>
              </div>
            )}
            {environments.map((e) => (
              <SidebarButton
                key={e.id}
                active={selectedEnvironment?.id === e.id}
                environment={e}
                onClick={() => setSelectedEnvironmentId(e.id)}
              >
                {e.name}
              </SidebarButton>
            ))}
          </div>
        </aside>
      )}
      secondSlot={() =>
        activeWorkspace != null && (
          <EnvironmentEditor
            className="pt-2 border-l border-border-subtle"
            environment={selectedEnvironment}
            workspace={activeWorkspace}
          />
        )
      }
    />
  );
};

const EnvironmentEditor = function ({
  environment,
  workspace,
  className,
}: {
  environment: Environment | null;
  workspace: Workspace;
  className?: string;
}) {
  const valueVisibility = useKeyValue<boolean>({
    namespace: 'global',
    key: 'environmentValueVisibility',
    fallback: true,
  });
  const environments = useEnvironments();
  const updateEnvironment = useUpdateEnvironment(environment?.id ?? null);
  const updateWorkspace = useUpdateWorkspace(workspace.id);
  const variables = environment == null ? workspace.variables : environment.variables;
  const handleChange = useCallback<PairEditorProps['onChange']>(
    (variables) => {
      if (environment != null) {
        updateEnvironment.mutate({ variables });
      } else {
        updateWorkspace.mutate({ variables });
      }
    },
    [updateWorkspace, updateEnvironment, environment],
  );

  // Gather a list of env names from other environments, to help the user get them aligned
  const nameAutocomplete = useMemo<GenericCompletionConfig>(() => {
    const otherEnvironments = environments.filter((e) => e.id !== environment?.id);
    const allVariableNames =
      environment == null
        ? [
            // Nothing to autocomplete if we're in the base environment
          ]
        : [
            ...workspace.variables.map((v) => v.name),
            ...otherEnvironments.flatMap((e) => e.variables.map((v) => v.name)),
          ];

    // Filter out empty strings and variables that already exist
    const variableNames = allVariableNames.filter(
      (name) => name != '' && !variables.find((v) => v.name === name),
    );
    const uniqueVariableNames = [...new Set(variableNames)];
    const options = uniqueVariableNames.map(
      (name): GenericCompletionOption => ({
        label: name,
        type: 'constant',
      }),
    );
    return { options };
  }, [environments, variables, workspace, environment]);

  const validateName = useCallback((name: string) => {
    // Empty just means the variable doesn't have a name yet, and is unusable
    if (name === '') return true;
    return name.match(/^[a-z_][a-z0-9_]*$/i) != null;
  }, []);

  return (
    <VStack space={4} className={classNames(className, 'pl-4')}>
      <HStack space={2} className="justify-between">
        <Heading className="w-full flex items-center gap-1">
          <div>{environment?.name ?? 'Global Variables'}</div>
          <IconButton
            iconClassName="text-text-subtlest"
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
          preferenceName="environment"
          nameAutocomplete={nameAutocomplete}
          nameAutocompleteVariables={false}
          namePlaceholder="VAR_NAME"
          nameValidate={validateName}
          valueType={valueVisibility.value ? 'text' : 'password'}
          valueAutocompleteVariables={true}
          forceUpdateKey={environment?.id ?? workspace?.id ?? 'n/a'}
          pairs={variables}
          onChange={handleChange}
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
  rightSlot,
  environment,
}: {
  className?: string;
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  rightSlot?: ReactNode;
  environment: Environment | null;
}) {
  const prompt = usePrompt();
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
              key: 'rename',
              label: 'Rename',
              leftSlot: <Icon icon="pencil" size="sm" />,
              onSelect: async () => {
                const name = await prompt({
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
              key: 'delete-environment',
              variant: 'danger',
              label: 'Delete',
              leftSlot: <Icon icon="trash" size="sm" />,
              onSelect: () => deleteEnvironment.mutate(),
            },
          ]}
        />
      )}
    </>
  );
}
