import type { HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';

interface Props {
  response: HttpResponse;
  className?: string;
  showReason?: boolean;
  short?: boolean;
}

export function HttpStatusTag({ response, className, showReason, short }: Props) {
  const { status, state } = response;

  let colorClass;
  let label = `${status}`;

  if (state === 'initialized') {
    label = short ? 'CONN' : 'CONNECTING';
    colorClass = 'text-text-subtle';
  } else if (status < 100) {
    label = short ? 'ERR' : 'ERROR';
    colorClass = 'text-danger';
  } else if (status < 200) {
    colorClass = 'text-info';
  } else if (status < 300) {
    colorClass = 'text-success';
  } else if (status < 400) {
    colorClass = 'text-primary';
  } else if (status < 500) {
    colorClass = 'text-warning';
  } else {
    colorClass = 'text-danger';
  }

  return (
    <span className={classNames(className, 'font-mono min-w-0', colorClass)}>
      {label} {showReason && 'statusReason' in response ? response.statusReason : null}
    </span>
  );
}
