import type { HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';

interface Props {
  response: HttpResponse;
  className?: string;
  showReason?: boolean;
}

export function StatusTag({ response, className, showReason }: Props) {
  const { status, state } = response;
  const label = status < 100 ? 'ERROR' : status;
  const category = `${status}`[0];
  const isInitializing = state === 'initialized';

  return (
    <span
      className={classNames(
        className,
        'font-mono',
        !isInitializing && category === '0' && 'text-danger',
        !isInitializing && category === '1' && 'text-info',
        !isInitializing && category === '2' && 'text-success',
        !isInitializing && category === '3' && 'text-primary',
        !isInitializing && category === '4' && 'text-warning',
        !isInitializing && category === '5' && 'text-danger',
        isInitializing && 'text-text-subtle',
      )}
    >
      {isInitializing ? 'CONNECTING' : label}{' '}
      {showReason && response.statusReason && response.statusReason}
    </span>
  );
}
