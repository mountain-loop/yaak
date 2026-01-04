import classNames from 'classnames';
import type { HotkeyAction } from '../../hooks/useHotKey';
import { useFormattedHotkey } from '../../hooks/useHotKey';
import { HStack } from './Stacks';

interface Props {
  action: HotkeyAction | null;
  className?: string;
  variant?: 'text' | 'with-bg';
}

export function Hotkey({ action, className, variant }: Props) {
  const labelParts = useFormattedHotkey(action);
  if (labelParts === null) {
    return null;
  }

  return <HotkeyRaw labelParts={labelParts} className={className} variant={variant} />;
}

interface HotkeyRawProps {
  labelParts: string[];
  className?: string;
  variant?: 'text' | 'with-bg';
}

export function HotkeyRaw({ labelParts, className, variant }: HotkeyRawProps) {
  return (
    <HStack
      className={classNames(
        className,
        variant === 'with-bg' &&
          'rounded bg-surface-highlight px-1 border border-border text-text-subtle',
        variant === 'text' && 'text-text-subtlest',
      )}
    >
      {labelParts.map((char, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: none
        <div key={index} className="min-w-[1em] text-center">
          {char}
        </div>
      ))}
    </HStack>
  );
}
