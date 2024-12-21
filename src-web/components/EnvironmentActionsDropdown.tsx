import classNames from 'classnames';
import { memo, useCallback, useMemo } from 'react';
import { useActiveEnvironment } from '../hooks/useActiveEnvironment';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useEnvironments } from '../hooks/useEnvironments';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import type { DropdownItem } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { useDialog } from '../hooks/useDialog';
import { EnvironmentEditDialog } from './EnvironmentEditDialog';

type Props = {
  className?: string;
} & Pick<ButtonProps, 'forDropdown' | 'leftSlot'>;

export const EnvironmentActionsDropdown = memo(function EnvironmentActionsDropdown({
  className,
  ...buttonProps
}: Props) {
  const environments = useEnvironments();
  const activeWorkspace = useActiveWorkspace();
  const [activeEnvironment, setActiveEnvironmentId] = useActiveEnvironment();
  const dialog = useDialog();

  const showEnvironmentDialog = useCallback(() => {
    dialog.toggle({
      id: 'environment-editor',
      noPadding: true,
      size: 'lg',
      className: 'h-[80vh]',
      render: () => <EnvironmentEditDialog initialEnvironment={activeEnvironment} />,
    });
  }, [dialog, activeEnvironment]);

  const items: DropdownItem[] = useMemo(
    () => [
      ...environments.map(
        (e) => ({
          key: e.id,
          label: e.name,
          leftSlot: e.id === activeEnvironment?.id ? <Icon icon="check" /> : <Icon icon="empty" />,
          onSelect: async () => {
            if (e.id !== activeEnvironment?.id) {
              setActiveEnvironmentId(e.id);
            } else {
              setActiveEnvironmentId(null);
            }
          },
        }),
        [activeEnvironment?.id],
      ),
      ...((environments.length > 0
        ? [{ type: 'separator', label: 'Environments' }]
        : []) as DropdownItem[]),
      {
        key: 'edit',
        label: 'Manage Environments',
        hotKeyAction: 'environmentEditor.toggle',
        leftSlot: <Icon icon="box" />,
        onSelect: showEnvironmentDialog,
      },
    ],
    [activeEnvironment?.id, environments, setActiveEnvironmentId, showEnvironmentDialog],
  );

  const hasWorkspaceVars =
    (activeWorkspace?.variables ?? []).filter((v) => v.enabled && (v.name || v.value)).length > 0;

  return (
    <Dropdown items={items}>
      <Button
        size="sm"
        className={classNames(
          className,
          'text !px-2 truncate',
          !activeEnvironment && !hasWorkspaceVars && 'text-text-subtlest italic',
        )}
        // If no environments, the button simply opens the dialog.
        // NOTE: We don't create a new button because we want to reuse the hotkey from the menu items
        onClick={environments.length === 0 ? showEnvironmentDialog : undefined}
        {...buttonProps}
      >
        {activeEnvironment?.name ?? (hasWorkspaceVars ? 'Environment' : 'No Environment')}
      </Button>
    </Dropdown>
  );
});
