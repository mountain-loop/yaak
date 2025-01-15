import xmlFormat from 'xml-formatter';
import { invokeCmd } from './tauri';

const INDENT = '  ';

export async function tryFormatJson(text: string): Promise<string> {
  if (text === '') return text;

  try {
    const result = await invokeCmd<string>('cmd_format_json', { text });
    return result;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    console.warn("Failed to format JSON", err);
    // Nothing
  }

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    // Nothing
  }

  return text;
}

export async function tryFormatXml(text: string): Promise<string> {
  if (text === '') return text;

  try {
    return xmlFormat(text, { throwOnFailure: true, strictMode: false, indentation: INDENT });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    return text;
  }
}
