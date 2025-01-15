import classNames from 'classnames';
import type { GrpcRequest, HttpRequest } from '@yaakapp-internal/models';

interface Props {
  request: HttpRequest | GrpcRequest;
  className?: string;
  shortNames?: boolean;
}

const longMethodMap = {
  get: 'GET',
  put: 'PUT',
  post: 'POST',
  patch: 'PATCH',
  delete: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
  grpc: 'GRPC',
} as const;

const shortMethodMap: Record<keyof typeof longMethodMap, string> = {
  get: 'GET',
  put: 'PUT',
  post: 'POST',
  patch: 'PTCH',
  delete: 'DEL',
  options: 'OPTS',
  head: 'HEAD',
  grpc: 'GRPC',
};

export function HttpMethodTag({ shortNames, request, className }: Props) {
  const method =
    request.model === 'http_request' && request.bodyType === 'graphql'
      ? 'GQL'
      : request.model === 'grpc_request'
        ? 'GRPC'
        : request.method;

  const m = method.toLowerCase();
  const methodMap: Record<string, string> = shortNames ? shortMethodMap : longMethodMap;
  return (
    <span
      className={classNames(
        className,
        'text-xs font-mono text-text-subtle',
        'pt-[0.25em]', // Fix for monospace font not vertically centering
        shortNames && 'w-[2.5em]',
      )}
    >
      {methodMap[m] ?? m.slice(0, 4).toUpperCase()}
    </span>
  );
}
