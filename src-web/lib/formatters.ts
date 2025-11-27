import vkBeautify from 'vkbeautify';
import { invokeCmd } from './tauri';

export async function tryFormatJson(text: string, indent = 2): Promise<string> {
  if (text === '') return text;

  try {
    return await invokeCmd<string>('cmd_format_json', { text, indent });
  } catch (err) {
    console.warn('Failed to format JSON', err);
  }

  try {
    return JSON.stringify(JSON.parse(text), null, indent);
  } catch (err) {
    console.log('JSON beautify failed', err);
  }

  return text;
}

export async function tryFormatXml(text: string, indent = 2): Promise<string> {
  if (text === '') return text;

  try {
    return vkBeautify.xml(text, ' '.repeat(indent));
  } catch (err) {
    console.warn('Failed to format XML', err);
  }

  return text;
}
