import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';

interface Props {
  request: HttpRequest | GrpcRequest | WebsocketRequest;
  className?: string;
  shortNames?: boolean;
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

export function HttpMethodTag({ request, className }: Props) {
  const method =
    request.model === 'http_request' && request.bodyType === 'graphql'
      ? 'GQL'
      : request.model === 'grpc_request'
        ? 'GRPC'
        : request.model === 'websocket_request'
          ? 'WS'
          : (methodNames[request.method.toLowerCase()] ?? request.method.slice(0, 4));

  const paddedMethod = method.padStart(4, ' ').toUpperCase();

  return (
    <span
      className={classNames(
        className,
        'text-xs font-mono text-text-subtle flex-shrink-0 whitespace-pre',
        'pt-[0.25em]', // Fix for monospace font not vertically centering
      )}
    >
      {paddedMethod}
    </span>
  );
}
