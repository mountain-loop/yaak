import type { HttpUrlParameter } from '@yaakapp-internal/models';
import { generateId } from './generateId';

export function prepareImportQuerystring(
  url: string,
): { url: string; urlParameters: HttpUrlParameter[] } | null {
  const split = url.split(/\?(.*)/s);
  const baseUrl = split[0] ?? '';
  const querystring = split[1] ?? '';

  // No querystring in url
  if (!querystring) {
    return null;
  }

  const parsedParams = Array.from(new URLSearchParams(querystring).entries());
  const urlParameters: HttpUrlParameter[] = parsedParams.map(([name, value]) => ({
    name,
    value,
    enabled: true,
    id: generateId(),
  }));

  return { url: baseUrl, urlParameters };
}
