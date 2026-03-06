import MimeType from 'whatwg-mimetype';
import type { EditorProps } from '../components/core/Editor/Editor';

export function languageFromContentType(
  contentType: string | null,
  content: string | null = null,
): EditorProps['language'] {
  const justContentType = contentType?.split(';')[0] ?? contentType ?? '';
  if (justContentType.includes('json')) {
    return 'json';
  }
  if (justContentType.includes('xml')) {
    return 'xml';
  }
  if (justContentType.includes('html')) {
    const detected = languageFromContent(content);
    if (detected === 'xml') {
      // If it's detected as XML, but is already HTML, don't change it
      return 'html';
    }
    return detected;
  }
  if (justContentType.includes('javascript')) {
    // Sometimes `application/javascript` returns JSON, so try detecting that
    return languageFromContent(content, 'javascript');
  }
  if (justContentType.includes('markdown')) {
    return 'markdown';
  }

  return languageFromContent(content, 'text');
}

export function languageFromContent(
  content: string | null,
  fallback?: EditorProps['language'],
): EditorProps['language'] {
  if (content == null) return 'text';

  const firstBytes = content.slice(0, 20).trim();

  if (firstBytes.startsWith('{') || firstBytes.startsWith('[')) {
    return 'json';
  }
  if (
    firstBytes.toLowerCase().startsWith('<!doctype') ||
    firstBytes.toLowerCase().startsWith('<html')
  ) {
    return 'html';
  }
  if (firstBytes.startsWith('<')) {
    return 'xml';
  }

  return fallback;
}

export function isJSON(content: string | null | undefined): boolean {
  if (typeof content !== 'string') return false;

  try {
    JSON.parse(content);
    return true;
  } catch {
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
