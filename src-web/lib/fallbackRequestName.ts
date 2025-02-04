import type { AnyModel } from '@yaakapp-internal/models';

export function fallbackRequestName(r: AnyModel | null): string {
  if (r == null) return '';

  if (!('url' in r) || r.model === 'plugin') {
    return 'name' in r ? r.name : '';
  }

  // Return name if it has one
  if ('name' in r && r.name) {
    return r.name;
  }

  // Replace variable syntax with variable name
  const withoutVariables = r.url.replace(/\$\{\[\s*([^\]\s]+)\s*]}/g, '$1');
  if (withoutVariables.trim() === '') {
    return r.model === 'http_request'
      ? 'HTTP Request'
      : r.model === 'websocket_request'
        ? 'WebSocket Request'
        : 'gRPC Request';
  }

  // GRPC gets nice short names
  if (r.model === 'grpc_request' && r.service != null && r.method != null) {
    const shortService = r.service.split('.').pop();
    return `${shortService}/${r.method}`;
  }

  // Strip unnecessary protocol
  const withoutProto = withoutVariables.replace(/^https?:\/\//, '');

  return withoutProto;
}
