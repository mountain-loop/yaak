import classNames from 'classnames';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import type { ButtonProps } from './Button';
import { Button } from './Button';
import { Label } from './Label';
import type { RadioDropdownItem } from './RadioDropdown';
import { RadioDropdown } from './RadioDropdown';
import { HStack } from './Stacks';
import { type } from '@tauri-apps/plugin-os';

export interface SelectProps<T extends string> {
  name: string;
  label: string;
  labelPosition?: 'top' | 'left';
  labelClassName?: string;
  hideLabel?: boolean;
  value: T;
  help?: ReactNode;
  leftSlot?: ReactNode;
  options: RadioDropdownItem<T>[];
  onChange: (value: T) => void;
  defaultValue?: T;
  size?: ButtonProps['size'];
  className?: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  labelPosition = 'top',
  name,
  help,
  labelClassName,
  disabled,
  hideLabel,
  label,
  value,
  options,
  leftSlot,
  onChange,
  className,
  defaultValue,
  size = 'md',
}: SelectProps<T>) {
  const [focused, setFocused] = useState<boolean>(false);
  const id = `input-${name}`;
  const isInvalidSelection = options.find((o) => 'value' in o && o.value === value) == null;

  const handleChange = (value: T) => {
    onChange?.(value);
  };

  return (
    <div
      className={classNames(
        className,
        'x-theme-input',
        'w-full',
        'pointer-events-auto', // Just in case we're placing in disabled parent
        labelPosition === 'left' && 'grid grid-cols-[auto_1fr] items-center gap-2',
        labelPosition === 'top' && 'flex-row gap-0.5',
      )}
    >
      <Label htmlFor={id} visuallyHidden={hideLabel} className={labelClassName} help={help}>
        {label}
      </Label>
      {type() === 'macos' ? (
        <HStack
          space={2}
          className={classNames(
            'w-full rounded-md text text-sm font-mono',
            'pl-2',
            'border',
            focused && !disabled ? 'border-border-focus' : 'border-border',
            disabled && 'border-dotted',
            isInvalidSelection && 'border-danger',
            size === 'xs' && 'h-xs',
            size === 'sm' && 'h-sm',
            size === 'md' && 'h-md',
          )}
        >
          {leftSlot && <div>{leftSlot}</div>}
          <select
            value={value}
            style={selectBackgroundStyles}
            onChange={(e) => handleChange(e.target.value as T)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className={classNames(
              'pr-7 w-full outline-none bg-transparent disabled:opacity-disabled',
            )}
            disabled={disabled}
          >
            {isInvalidSelection && <option value={'__NONE__'}>-- Select an Option --</option>}
            {options.map((o) => {
              if (o.type === 'separator') return null;
              return (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {o.value === defaultValue && ' (default)'}
                </option>
              );
            })}
          </select>
        </HStack>
      ) : (
        // Use custom "select" component until Tauri can be configured to have select menus not always appear in
        // light mode
        <RadioDropdown value={value} onChange={handleChange} items={options}>
          <Button
            className="w-full text-sm font-mono"
            justify="start"
            variant="border"
            size={size}
            leftSlot={leftSlot}
            disabled={disabled}
            forDropdown
          >
            {options.find((o) => o.type !== 'separator' && o.value === value)?.label ?? '--'}
          </Button>
        </RadioDropdown>
      )}
    </div>
  );
}

const selectBackgroundStyles: CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
  backgroundPosition: 'right 0.3rem center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '1.5em 1.5em',
  appearance: 'none',
  printColorAdjust: 'exact',
};
