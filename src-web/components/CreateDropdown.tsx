import { useCreateDropdownItems } from '../hooks/useCreateDropdownItems';
import type { DropdownProps } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';

interface Props extends Omit<DropdownProps, 'items'> {
  hideFolder?: boolean;
}

export function CreateDropdown({ hideFolder, children, ...props }: Props) {
  const getItems = useCreateDropdownItems({
    hideFolder,
    hideIcons: true,
    folderId: 'active-folder',
  });

  return (
    <Dropdown items={getItems} {...props}>
      {children}
    </Dropdown>
  );
}
