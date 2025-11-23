import classNames from 'classnames';
import { memo, useMemo } from 'react';
import { useActiveEnvironment } from '../hooks/useActiveEnvironment';
import { useEnvironmentsBreakdown } from '../hooks/useEnvironmentsBreakdown';
import { editEnvironment } from '../lib/editEnvironment';
import { setWorkspaceSearchParams } from '../lib/setWorkspaceSearchParams';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import type { DropdownItem } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { EnvironmentColorIndicator } from './EnvironmentColorIndicator';

type Props = {
  className?: string;
} & Pick<ButtonProps, 'forDropdown' | 'leftSlot'>;

export const EnvironmentActionsDropdown = memo(function EnvironmentActionsDropdown({
  className,
  ...buttonProps
}: Props) {
  const { subEnvironments, baseEnvironment } = useEnvironmentsBreakdown();
  const activeEnvironment = useActiveEnvironment();

  const items: DropdownItem[] = useMemo(
    () => [
      ...subEnvironments.map(
        (e) => ({
          key: e.id,
          label: e.name,
          rightSlot: <EnvironmentColorIndicator environment={e} />,
          leftSlot: e.id === activeEnvironment?.id ? <Icon icon="check" /> : <Icon icon="empty" />,
          onSelect: async () => {
            if (e.id !== activeEnvironment?.id) {
              setWorkspaceSearchParams({ environment_id: e.id });
            } else {
              setWorkspaceSearchParams({ environment_id: null });
            }
          },
        }),
        [activeEnvironment?.id],
      ),
      ...((subEnvironments.length > 0
        ? [{ type: 'separator', label: 'Environments' }]
        : []) as DropdownItem[]),
      {
        label: 'Manage Environments',
        hotKeyAction: 'environmentEditor.toggle',
        leftSlot: <Icon icon="box" />,
        onSelect: () => editEnvironment(activeEnvironment),
      },
    ],
    [subEnvironments, activeEnvironment],
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
        onClick={subEnvironments.length === 0 ? () => editEnvironment(null) : undefined}
        {...buttonProps}
      >
        <EnvironmentColorIndicator environment={activeEnvironment ?? null} />
        {activeEnvironment?.name ?? (hasBaseVars ? 'Environment' : 'No Environment')}
      </Button>
    </Dropdown>
  );
});
