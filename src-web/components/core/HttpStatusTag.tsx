import type { HttpResponse, HttpResponseState } from '@yaakapp-internal/models';
import classNames from 'classnames';

interface Props {
  response: HttpResponse;
  className?: string;
  showReason?: boolean;
  short?: boolean;
}

export function HttpStatusTag({ response, ...props }: Props) {
  const { status, state, statusReason } = response;
  return <HttpStatusTagRaw status={status} state={state} statusReason={statusReason} {...props} />;
}

export function HttpStatusTagRaw({
  status,
  state,
  className,
  showReason,
  statusReason,
  short,
}: Omit<Props, 'response'> & {
  status: number | string;
  state?: HttpResponseState;
  statusReason?: string | null;
}) {
  let colorClass: string;
  let label = `${status}`;
  const statusN = typeof status === 'number' ? status : parseInt(status, 10);

  if (state === 'initialized') {
    label = short ? 'CONN' : 'CONNECTING';
    colorClass = 'text-text-subtle';
  } else if (statusN < 100) {
    label = short ? 'ERR' : 'ERROR';
    colorClass = 'text-danger';
  } else if (statusN < 200) {
    colorClass = 'text-info';
  } else if (statusN < 300) {
    colorClass = 'text-success';
  } else if (statusN < 400) {
    colorClass = 'text-primary';
  } else if (statusN < 500) {
    colorClass = 'text-warning';
  } else {
    colorClass = 'text-danger';
  }

  return (
    <span className={classNames(className, 'font-mono min-w-0', colorClass)}>
      {label} {showReason && statusReason}
    </span>
  );
}
