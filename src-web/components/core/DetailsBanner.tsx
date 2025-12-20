import classNames from 'classnames';
import { atom, useAtom } from 'jotai';
import type { HTMLAttributes, ReactNode } from 'react';
import { useMemo } from 'react';
import { atomWithKVStorage } from '../../lib/atoms/atomWithKVStorage';
import type { BannerProps } from './Banner';
import { Banner } from './Banner';

interface Props extends HTMLAttributes<HTMLDetailsElement> {
  summary: ReactNode;
  color?: BannerProps['color'];
  defaultOpen?: boolean;
  storageKey?: string;
}

export function DetailsBanner({
  className,
  color,
  summary,
  children,
  defaultOpen,
  storageKey,
  ...extraProps
}: Props) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: We only want to recompute the atom when storageKey changes
  const openAtom = useMemo(
    () =>
      storageKey
        ? atomWithKVStorage<boolean>(['details_banner', storageKey], defaultOpen ?? false)
        : atom(defaultOpen ?? false),
    [storageKey],
  );

  const [isOpen, setIsOpen] = useAtom(openAtom);

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (storageKey) {
      setIsOpen(e.currentTarget.open);
    }
  };

  return (
    <Banner color={color} className={className}>
      <details className="group list-none" open={isOpen} onToggle={handleToggle} {...extraProps}>
        <summary className="!cursor-default !select-none list-none flex items-center gap-3 focus:outline-none opacity-70">
          <div
            className={classNames(
              'transition-transform',
              'group-open:rotate-90',
              'w-0 h-0 border-t-[0.3em] border-b-[0.3em] border-l-[0.5em] border-r-0',
              'border-t-transparent border-b-transparent border-l-text-subtle',
            )}
          />
          {summary}
        </summary>
        <div className="mt-1.5 pb-2">{children}</div>
      </details>
    </Banner>
  );
}
