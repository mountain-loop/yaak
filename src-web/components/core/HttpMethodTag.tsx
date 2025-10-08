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

  return (
    <span
      className={classNames(
        className,
        !colored && 'text-text-subtle',
        colored && method === 'GQL' && 'text-info',
        colored && method === 'WS' && 'text-info',
        colored && method === 'GRPC' && 'text-info',
        colored && method === 'OPTIONS' && 'text-info',
        colored && method === 'HEAD' && 'text-info',
        colored && method === 'GET' && 'text-primary',
        colored && method === 'PUT' && 'text-warning',
        colored && method === 'PATCH' && 'text-notice',
        colored && method === 'POST' && 'text-success',
        colored && method === 'DELETE' && 'text-danger',
        'font-mono flex-shrink-0 whitespace-pre',
        'pt-[0.15em]', // Fix for monospace font not vertically centering
      )}
    >
      {label}
    </span>
  );
}
