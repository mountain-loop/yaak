import type { WebsocketConnection } from '@yaakapp-internal/models';
import classNames from 'classnames';

interface Props {
  response: WebsocketConnection;
  className?: string;
}

export function WebsocketStatusTag({ response, className }: Props) {
  const { status, state } = response;
  const isInitializing = state === 'initialized';

  let label = 'CONNECTING';
  let category = '0';
  if (state === 'initialized'){
    label = 'CONNECTING';
    category = '1';
  } else if (state === 'connected'){
    label = 'CONNECTED';
    category = '2';
  } else {
    label = 'CLOSED';
    category = '4';
    if (status < 0){
      label = 'ERROR';
      category = '5';
    }
  }

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
      {label}{' '}
    </span>
  );
}