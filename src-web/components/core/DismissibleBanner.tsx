import classNames from 'classnames';
import { useKeyValue } from '../../hooks/useKeyValue';
import type { BannerProps } from './Banner';
import { Banner } from './Banner';
import { IconButton } from './IconButton';

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
    <Banner className={classNames(className, 'relative pr-8')} {...props}>
      <IconButton
        className="!absolute right-0 top-0"
        icon="x"
        onClick={() => setDismissed((d) => !d)}
        title="Dismiss message"
      />
      {children}
    </Banner>
  );
}
