import xmlFormat from 'xml-formatter';
import { jsonrepair } from 'jsonrepair';
import { invokeCmd } from './tauri';

const INDENT = '  ';

export async function tryFormatJson(
  text: string,
  options: { repair?: boolean } = {},
): Promise<string> {
  if (text === '') return text;

  // Normalize whitespace and repair JSON
  let repairedText = text;
  try {
    repairedText = options.repair
      ? jsonrepair(text.replace(/(^|\r?\n)\s*[\u3000\u2000-\u200F\u2028-\u202F]+/g, '$1  '))
      : text;
  } catch {
    // Leave unrepaired repair fails. This could be caused by {"foo": ${[ BAR ]}} template syntax
  }

  try {
    const result = await invokeCmd<string>('cmd_format_json', { text: repairedText });
    return result;
  } catch {
    return repairedText;
  }
}

export async function tryFormatXml(text: string): Promise<string> {
  if (text === '') return text;

  try {
    return xmlFormat(text, { throwOnFailure: true, strictMode: false, indentation: INDENT });
  } catch (error) {
    console.error('Failed to format XML:', error);
    return text;
  }
}
