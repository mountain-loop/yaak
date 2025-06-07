import { settingsAtom } from '@yaakapp-internal/models';
import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
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
};

export function HttpMethodTag({ request, className, short }: Props) {
  const settings = useAtomValue(settingsAtom);
  const method =
    request.model === 'http_request' && request.bodyType === 'graphql'
      ? 'GQL'
      : request.model === 'grpc_request'
        ? 'GRPC'
        : request.model === 'websocket_request'
          ? 'WS'
          : request.method;
  let label = method.toUpperCase();

  if (short) {
    label = methodNames[method.toLowerCase()] ?? method.slice(0, 4);
    label = label.padStart(4, ' ');
  }

  return (
    <span
      className={classNames(
        className,
        !settings.coloredMethods && 'text-text-subtle',
        settings.coloredMethods && method === 'GQL' && 'text-info',
        settings.coloredMethods && method === 'WS' && 'text-info',
        settings.coloredMethods && method === 'GRPC' && 'text-info',
        settings.coloredMethods && method === 'OPTIONS' && 'text-info',
        settings.coloredMethods && method === 'HEAD' && 'text-info',
        settings.coloredMethods && method === 'GET' && 'text-primary',
        settings.coloredMethods && method === 'PUT' && 'text-warning',
        settings.coloredMethods && method === 'PATCH' && 'text-notice',
        settings.coloredMethods && method === 'POST' && 'text-success',
        settings.coloredMethods && method === 'DELETE' && 'text-danger',
        'font-mono flex-shrink-0 whitespace-pre',
        'pt-[0.25em]', // Fix for monospace font not vertically centering
      )}
    >
      {label}
    </span>
  );
}
