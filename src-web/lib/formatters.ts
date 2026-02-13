import vkBeautify from 'vkbeautify';
import { invokeCmd } from './tauri';
import { getSettings } from './settings';

export async function tryFormatJson(text: string): Promise<string> {
  if (text === '') return text;

  const settings = await getSettings();
  const indent = settings.editorIndentation;

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

export async function tryFormatXml(text: string): Promise<string> {
  if (text === '') return text;

  const settings = await getSettings();
  const indent = settings.editorIndentation;

  try {
    return vkBeautify.xml(text, ' '.repeat(indent));
  } catch (err) {
    console.warn('Failed to format XML', err);
  }

  return text;
}
