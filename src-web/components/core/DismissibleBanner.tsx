import type { Color } from '@yaakapp-internal/plugins';
import classNames from 'classnames';
import { useKeyValue } from '../../hooks/useKeyValue';
import type { BannerProps } from './Banner';
import { Banner } from './Banner';
import { Button } from './Button';
import { HStack } from './Stacks';

export function DismissibleBanner({
  children,
  className,
  id,
  actions,
  ...props
}: BannerProps & { id: string; actions?: { label: string; onClick: () => void; color?: Color }[] }) {
  const { set: setDismissed, value: dismissed } = useKeyValue<boolean>({
    namespace: 'global',
    key: ['dismiss-banner', id],
    fallback: false,
  });

  if (dismissed) return null;

  return (
    <Banner
      className={classNames(className, 'relative grid grid-cols-[1fr_auto] gap-3')}
      {...props}
    >
      {children}
      <HStack space={1.5}>
        {actions?.map((a, i) => (
          <Button
            key={a.label + i}
            variant="border"
            color={a.color ?? props.color}
            size="xs"
            onClick={a.onClick}
            title="Dismiss message"
          >
            {a.label}
          </Button>
        ))}
        <Button
          variant="border"
          color={props.color}
          size="xs"
          onClick={() => setDismissed((d) => !d)}
          title="Dismiss message"
        >
          Dismiss
        </Button>
      </HStack>
    </Banner>
  );
}
