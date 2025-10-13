import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { settingsAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';

interface Props {
  request: HttpRequest | GrpcRequest | WebsocketRequest;
  className?: string;
  short?: boolean;
}

const methodNames: Record<string, string> = {
  get: 'GET',
  put: 'PUT',
  post: 'POST',
  patch: 'PTCH',
  delete: 'DELE',
  options: 'OPTN',
  head: 'HEAD',
  query: 'QURY',
  graphql: 'GQL',
  grpc: 'GRPC',
  websocket: 'WS',
};

export function HttpMethodTag({ request, className, short }: Props) {
  const settings = useAtomValue(settingsAtom);
  const method =
    request.model === 'http_request' && request.bodyType === 'graphql'
      ? 'graphql'
      : request.model === 'grpc_request'
        ? 'grpc'
        : request.model === 'websocket_request'
          ? 'websocket'
          : request.method;

  return (
    <HttpMethodTagRaw
      method={method}
      colored={settings.coloredMethods}
      className={className}
      short={short}
    />
  );
}

export function HttpMethodTagRaw({
  className,
  method,
  colored,
  short,
}: {
  method: string;
  className?: string;
  colored: boolean;
  short?: boolean;
}) {
  let label = method.toUpperCase();
  if (short) {
    label = methodNames[method.toLowerCase()] ?? method.slice(0, 4);
    label = label.padStart(4, ' ');
  }

  const m = method.toUpperCase();

  return (
    <span
      className={classNames(
        className,
        !colored && 'text-text-subtle',
        colored && m === 'GRAPHQL' && 'text-info',
        colored && m === 'WEBSOCKET' && 'text-info',
        colored && m === 'GRPC' && 'text-info',
        colored && m === 'QUERY' && 'text-secondary',
        colored && m === 'OPTIONS' && 'text-info',
        colored && m === 'HEAD' && 'text-secondary',
        colored && m === 'GET' && 'text-primary',
        colored && m === 'PUT' && 'text-warning',
        colored && m === 'PATCH' && 'text-notice',
        colored && m === 'POST' && 'text-success',
        colored && m === 'DELETE' && 'text-danger',
        'font-mono flex-shrink-0 whitespace-pre',
        'pt-[0.15em]', // Fix for monospace font not vertically centering
      )}
    >
      {label}
    </span>
  );
}
