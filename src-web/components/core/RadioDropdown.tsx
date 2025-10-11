import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { DropdownItem, DropdownItemSeparator, DropdownProps } from './Dropdown';
import { Dropdown } from './Dropdown';
import { Icon } from './Icon';

export type RadioDropdownItem<T = string | null> =
  | {
      type?: 'default';
      label: ReactNode;
      shortLabel?: ReactNode;
      value: T;
      rightSlot?: ReactNode;
    }
  | DropdownItemSeparator;

export interface RadioDropdownProps<T = string | null> {
  value: T;
  onChange: (value: T) => void;
  itemsBefore?: DropdownItem[];
  items: RadioDropdownItem<T>[];
  itemsAfter?: DropdownItem[];
  children: DropdownProps['children'];
}

export function RadioDropdown<T = string | null>({
  value,
  items,
  itemsAfter,
  itemsBefore,
  onChange,
  children,
}: RadioDropdownProps<T>) {
  const dropdownItems = useMemo(
    () => [
      ...((itemsBefore
        ? [
            ...itemsBefore,
            {
              type: 'separator',
              hidden: itemsBefore[itemsBefore.length - 1]?.type === 'separator',
            },
          ]
        : []) as DropdownItem[]),
      ...items.map((item) => {
        if (item.type === 'separator') {
          return item;
        } else {
          return {
            key: item.value,
            label: item.label,
            rightSlot: item.rightSlot,
            onSelect: () => onChange(item.value),
            leftSlot: <Icon icon={value === item.value ? 'check' : 'empty'} />,
          } as DropdownItem;
        }
      }),
      ...((itemsAfter
        ? [{ type: 'separator', hidden: itemsAfter[0]?.type === 'separator' }, ...itemsAfter]
        : []) as DropdownItem[]),
    ],
    [itemsBefore, items, itemsAfter, value, onChange],
  );

  return (
    <Dropdown fullWidth items={dropdownItems}>
      {children}
    </Dropdown>
  );
}
