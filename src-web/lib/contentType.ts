import MimeType from 'whatwg-mimetype';
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

  const firstBytes = content.slice(0, 20).trim();
  console.log("FIRST BYTES", firstBytes);

  if (firstBytes.startsWith('{') || firstBytes.startsWith('[')) {
    return 'json';
  } else if (
    firstBytes.toLowerCase().startsWith('<!doctype') ||
    firstBytes.toLowerCase().startsWith('<html')
  ) {
    return 'html';
  } else if (firstBytes.startsWith('<')) {
    return 'xml';
  }

  return fallback;
}

export function isJSON(content: string | null | undefined): boolean {
  if (typeof content !== 'string') return false;

  try {
    JSON.parse(content);
    return true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    return false;
  }
}

export function isProbablyTextContentType(contentType: string | null): boolean {
  if (contentType == null) return false;

  const mimeType = getMimeTypeFromContentType(contentType).essence;
  const normalized = mimeType.toLowerCase();

  // Check if it starts with "text/"
  if (normalized.startsWith('text/')) {
    return true;
  }

  // Common text mimetypes and suffixes
  return [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/yaml',
    '+json',
    '+xml',
    '+yaml',
    '+text',
  ].some((textType) => normalized === textType || normalized.endsWith(textType));
}

export function getMimeTypeFromContentType(contentType: string): MimeType {
  try {
    return new MimeType(contentType);
  } catch {
    return new MimeType('text/plain');
  }
}
