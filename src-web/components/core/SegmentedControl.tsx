import classNames from 'classnames';
import { type ReactNode, useRef } from 'react';
import { useStateWithDeps } from '../../hooks/useStateWithDeps';
import { generateId } from '../../lib/generateId';
import { Button } from './Button';
import type { IconProps } from './Icon';
import { IconButton, type IconButtonProps } from './IconButton';
import { Label } from './Label';
import { HStack } from './Stacks';

interface Props<T extends string> {
  options: { value: T; label: string; icon?: IconProps['icon'] }[];
  onChange: (value: T) => void;
  value: T;
  name: string;
  size?: IconButtonProps['size'];
  label: string;
  className?: string;
  hideLabel?: boolean;
  labelClassName?: string;
  help?: ReactNode;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'xs',
  label,
  hideLabel,
  labelClassName,
  help,
  className,
}: Props<T>) {
  const [selectedValue, setSelectedValue] = useStateWithDeps<T>(value, [value]);
  const containerRef = useRef<HTMLDivElement>(null);
  const id = useRef(`input-${generateId()}`);

  return (
    <div className="w-full grid">
      <Label
        htmlFor={id.current}
        help={help}
        visuallyHidden={hideLabel}
        className={classNames(labelClassName)}
      >
        {label}
      </Label>
      <HStack
        id={id.current}
        ref={containerRef}
        role="group"
        dir="ltr"
        space={1}
        className={classNames(
          className,
          'bg-surface-highlight rounded-lg mb-auto mr-auto',
          'transition-opacity transform-gpu p-1',
        )}
        onKeyDown={(e) => {
          const selectedIndex = options.findIndex((o) => o.value === selectedValue);
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            const newIndex = Math.abs((selectedIndex + 1) % options.length);
            options[newIndex] && setSelectedValue(options[newIndex].value);
            const child = containerRef.current?.children[newIndex] as HTMLButtonElement;
            child.focus();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const newIndex = Math.abs((selectedIndex - 1) % options.length);
            options[newIndex] && setSelectedValue(options[newIndex].value);
            const child = containerRef.current?.children[newIndex] as HTMLButtonElement;
            child.focus();
          }
        }}
      >
        {options.map((o) => {
          const isSelected = selectedValue === o.value;
          const isActive = value === o.value;
          if (o.icon == null) {
            return (
              <Button
                key={o.label}
                size={size}
                variant="solid"
                color={isActive ? 'secondary' : undefined}
                role="radio"
                tabIndex={isSelected ? 0 : -1}
                className={classNames(
                  isActive && '!text-text',
                  'focus:ring-1 focus:ring-border-focus',
                )}
                onClick={() => onChange(o.value)}
              >
                {o.label}
              </Button>
            );
          } else {
            return (
              <IconButton
                key={o.label}
                size={size}
                variant="solid"
                color={isActive ? 'secondary' : undefined}
                role="radio"
                tabIndex={isSelected ? 0 : -1}
                className={classNames(
                  isActive && '!text-text',
                  '!px-1.5 !w-auto',
                  'focus:ring-border-focus',
                )}
                title={o.label}
                icon={o.icon}
                onClick={() => onChange(o.value)}
              />
            );
          }
        })}
      </HStack>
    </div>
  );
}
