import type { WebsocketConnection } from '@yaakapp-internal/models';
import classNames from 'classnames';

interface Props {
  connection: WebsocketConnection;
  className?: string;
}

export function WebsocketStatusTag({ connection, className }: Props) {
  const { state, error } = connection;

  let label;
  let colorClass = 'text-text-subtle';

  if (error) {
    label = 'ERROR';
    colorClass = 'text-danger';
  } else if (state === 'connected') {
    label = 'CONNECTED';
    colorClass = 'text-success';
  } else if (state === 'closing') {
    label = 'CLOSING';
  } else if (state === 'closed') {
    label = 'CLOSED';
    colorClass = 'text-warning';
  } else {
    label = 'CONNECTING';
  }

  return <span className={classNames(className, 'font-mono', colorClass)}>{label}</span>;
}
