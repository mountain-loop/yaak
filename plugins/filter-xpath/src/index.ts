import xpath from 'xpath';
import { DOMParser } from '@xmldom/xmldom';

export function pluginHookResponseFilter(ctx: any, filter: string, text: string) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const filtered = `${xpath.select(filter, doc)}`;
  return { filtered };
}