import classNames from 'classnames';
import { memo, useCallback, useMemo } from 'react';
import { useActiveEnvironment } from '../hooks/useActiveEnvironment';
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
  const { subEnvironments, baseEnvironment } = useEnvironments();
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
      ...subEnvironments.map(
        (e) => ({
          key: e.id,
          label: e.name,
          leftSlot: e.id === activeEnvironment?.id ? <Icon icon="check" /> : <Icon icon="empty" />,
          onSelect: async () => {
            if (e.id !== activeEnvironment?.id) {
              await setActiveEnvironmentId(e.id);
            } else {
              await setActiveEnvironmentId(null);
            }
          },
        }),
        [activeEnvironment?.id],
      ),
      ...((subEnvironments.length > 0
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
    [activeEnvironment?.id, subEnvironments, setActiveEnvironmentId, showEnvironmentDialog],
  );

  const hasBaseVars =
    (baseEnvironment?.variables ?? []).filter((v) => v.enabled && (v.name || v.value)).length > 0;

  return (
    <Dropdown items={items}>
      <Button
        size="sm"
        className={classNames(
          className,
          'text !px-2 truncate',
          !activeEnvironment && !hasBaseVars && 'text-text-subtlest italic',
        )}
        // If no environments, the button simply opens the dialog.
        // NOTE: We don't create a new button because we want to reuse the hotkey from the menu items
        onClick={subEnvironments.length === 0 ? showEnvironmentDialog : undefined}
        {...buttonProps}
      >
        {activeEnvironment?.name ?? (hasBaseVars ? 'Environment' : 'No Environment')}
      </Button>
    </Dropdown>
  );
});
