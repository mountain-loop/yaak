import classNames from 'classnames';
import { useKeyValue } from '../../hooks/useKeyValue';
import type { BannerProps } from './Banner';
import { Banner } from './Banner';
import { Button } from './Button';

export function DismissibleBanner({
  children,
  className,
  id,
  ...props
}: BannerProps & { id: string }) {
  const { set: setDismissed, value: dismissed } = useKeyValue<boolean>({
    namespace: 'global',
    key: ['dismiss-banner', id],
    fallback: false,
  });

  if (dismissed) return null;

  return (
    <Banner className={classNames(className, 'relative grid grid-cols-[1fr_auto] gap-3')} {...props}>
      {children}
      <Button
        variant="border"
        color={props.color}
        size="xs"
        onClick={() => setDismissed((d) => !d)}
        title="Dismiss message"
      >
        Dismiss
      </Button>
    </Banner>
  );
}
