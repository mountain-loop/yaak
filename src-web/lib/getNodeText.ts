import type { ReactNode } from 'react';

/**
 * Get the text content from a ReactNode
 * https://stackoverflow.com/questions/50428910/get-text-content-from-node-in-react
 */
export function getNodeText(node: ReactNode): string {
  if (['string', 'number'].includes(typeof node)) {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getNodeText).join('');
  }

  if (typeof node === 'object' && node) {
    // biome-ignore lint/suspicious/noExplicitAny: none
    return getNodeText((node as any).props.children);
  }

  return '';
}
