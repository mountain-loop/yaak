import classNames from 'classnames';
import type { HotkeyAction } from '../../hooks/useHotKey';
import { useFormattedHotkey } from '../../hooks/useHotKey';
import { HStack } from './Stacks';

interface Props {
  action: HotkeyAction | null;
  className?: string;
  variant?: 'text' | 'with-bg';
}

export function HotKey({ action, className, variant }: Props) {
  const labelParts = useFormattedHotkey(action);
  if (labelParts === null) {
    return null;
  }

  return (
    <HStack
      className={classNames(
        className,
        variant === 'with-bg' && 'rounded border',
        'text-text-subtlest',
      )}
    >
      {labelParts.map((char, index) => (
        <div key={index} className="min-w-[1.1em] text-center">
          {char}
        </div>
      ))}
    </HStack>
  );
}
