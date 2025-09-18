import type { AnyModel, Cookie, Environment, HttpResponseHeader } from '@yaakapp-internal/models';
import { getMimeTypeFromContentType } from './contentType';

export const BODY_TYPE_NONE = null;
export const BODY_TYPE_GRAPHQL = 'graphql';
export const BODY_TYPE_JSON = 'application/json';
export const BODY_TYPE_BINARY = 'binary';
export const BODY_TYPE_OTHER = 'other';
export const BODY_TYPE_FORM_URLENCODED = 'application/x-www-form-urlencoded';
export const BODY_TYPE_FORM_MULTIPART = 'multipart/form-data';
export const BODY_TYPE_XML = 'text/xml';

export function cookieDomain(cookie: Cookie): string {
  if (cookie.domain === 'NotPresent' || cookie.domain === 'Empty') {
    return 'n/a';
  }
  if ('HostOnly' in cookie.domain) {
    return cookie.domain.HostOnly;
  }
  if ('Suffix' in cookie.domain) {
    return cookie.domain.Suffix;
  }
  return 'unknown';
}

export function modelsEq(a: AnyModel, b: AnyModel) {
  if (a.model != b.model) {
    return false;
  }
  if (a.model === 'key_value' && b.model === 'key_value') {
    return a.key === b.key && a.namespace === b.namespace;
  }
  if ('id' in a && 'id' in b) {
    return a.id === b.id;
  }
  return false;
}

export function getContentTypeFromHeaders(headers: HttpResponseHeader[] | null): string | null {
  return headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? null;
}

export function getCharsetFromContentType(headers: HttpResponseHeader[]): string | null {
  const contentType = getContentTypeFromHeaders(headers);
  if (contentType == null) return null;

  const mimeType = getMimeTypeFromContentType(contentType);
  return mimeType.parameters.get('charset') ?? null;
}

export function isBaseEnvironment(environment: Environment): boolean {
  return environment.parentId == null;
}
