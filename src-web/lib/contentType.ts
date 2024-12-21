import type { EditorProps } from '../components/core/Editor/Editor';

export function languageFromContentType(
  contentType: string | null,
  content: string | null = null,
): EditorProps['language'] {
  const justContentType = contentType?.split(';')[0] ?? contentType ?? '';
  if (justContentType.includes('json')) {
    return 'json';
  } else if (justContentType.includes('xml')) {
    return 'xml';
  } else if (justContentType.includes('html')) {
    return detectFromContent(content, 'html');
  } else if (justContentType.includes('javascript')) {
    return 'javascript';
  }

  return detectFromContent(content, 'text');
}

function detectFromContent(
  content: string | null,
  fallback: EditorProps['language'],
): EditorProps['language'] {
  if (content == null) return 'text';

  if (content.startsWith('{') || content.startsWith('[')) {
    return 'json';
  } else if (
    content.toLowerCase().startsWith('<!doctype') ||
    content.toLowerCase().startsWith('<html')
  ) {
    return 'html';
  }

  return fallback;
}

export function isJSON(content: string | null | undefined): boolean {
  if (typeof content !== 'string') return false;

  try {
    JSON.parse(content)
    return true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    return false;
  }
}
