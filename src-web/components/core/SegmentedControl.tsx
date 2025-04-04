import classNames from 'classnames';
import { useRef } from 'react';
import { useStateWithDeps } from '../../hooks/useStateWithDeps';
import type { IconProps } from './Icon';
import { IconButton } from './IconButton';
import { HStack } from './Stacks';

interface Props<T extends string> {
  options: { value: T; label: string; icon: IconProps['icon'] }[];
  onChange: (value: T) => void;
  value: T;
  name: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: Props<T>) {
  const [selectedValue, setSelectedValue] = useStateWithDeps<T>(value, [value]);
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <HStack
      ref={containerRef}
      role="group"
      dir="ltr"
      space={0.5}
      className={classNames(
        className,
        'bg-surface-highlight rounded-md mb-auto opacity-0',
        'transition-opacity transform-gpu',
        'group-focus-within/markdown:opacity-100 group-hover/markdown:opacity-100',
      )}
      onKeyDown={(e) => {
        const selectedIndex = options.findIndex((o) => o.value === selectedValue);
        if (e.key === 'ArrowRight') {
          const newIndex = Math.abs((selectedIndex + 1) % options.length);
          setSelectedValue(options[newIndex]!.value);
          const child = containerRef.current?.children[newIndex] as HTMLButtonElement;
          child.focus();
        } else if (e.key === 'ArrowLeft') {
          const newIndex = Math.abs((selectedIndex - 1) % options.length);
          setSelectedValue(options[newIndex]!.value);
          const child = containerRef.current?.children[newIndex] as HTMLButtonElement;
          child.focus();
        }
      }}
    >
      {options.map((o, i) => {
        const isSelected = selectedValue === o.value;
        const isActive = value === o.value;
        return (
          <IconButton
            size="xs"
            variant="solid"
            color={isActive ? 'secondary' : undefined}
            role="radio"
            tabIndex={isSelected ? 0 : -1}
            className={classNames(
              isActive && '!text-text',
              '!px-1.5 !w-auto',
              'focus:ring-border-focus',
            )}
            key={i}
            title={o.label}
            icon={o.icon}
            onClick={() => onChange(o.value)}
          />
        );
      })}
    </HStack>
  );
}
