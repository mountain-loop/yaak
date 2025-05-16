import classNames from 'classnames';
import { type ReactNode } from 'react';
import { Icon } from './Icon';
import { IconTooltip } from './IconTooltip';
import { HStack } from './Stacks';

export interface CheckboxProps {
  checked: boolean | 'indeterminate';
  title: ReactNode;
  onChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
  inputWrapperClassName?: string;
  hideLabel?: boolean;
  fullWidth?: boolean;
  help?: ReactNode;
}

export function Checkbox({
  checked,
  onChange,
  className,
  inputWrapperClassName,
  disabled,
  title,
  hideLabel,
  fullWidth,
  help,
}: CheckboxProps) {
  return (
    <HStack
      as="label"
      alignItems="center"
      space={3}
      className={classNames(className, 'text-text mr-auto')}
    >
      <div className={classNames(inputWrapperClassName, 'x-theme-input', 'relative flex')}>
        <input
          aria-hidden
          className={classNames(
            'appearance-none w-4 h-4 flex-shrink-0 border border-border',
            'rounded outline-none ring-0',
            !disabled && 'hocus:border-border-focus hocus:bg-focus/[5%] ',
            disabled && 'border-dotted',
          )}
          type="checkbox"
          disabled={disabled}
          onChange={() => {
            onChange(checked === 'indeterminate' ? true : !checked);
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon
            size="sm"
            icon={checked === 'indeterminate' ? 'minus' : checked ? 'check' : 'empty'}
          />
        </div>
      </div>
      {!hideLabel && (
        <div className={classNames(fullWidth && 'w-full', disabled && 'opacity-disabled')}>
          {title}
        </div>
      )}
      {help && <IconTooltip content={help} />}
    </HStack>
  );
}
