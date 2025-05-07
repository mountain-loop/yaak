import { clear, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { showToast } from './toast';

export function copyToClipboard(
  text: string | null,
  { disableToast }: { disableToast?: boolean } = {},
) {
  if (text == null) {
    clear().catch(console.error);
  } else {
    writeText(text).catch(console.error);
  }

  if (text != '' && !disableToast) {
    showToast({
      id: 'copied',
      color: 'success',
      icon: 'copy',
      message: 'Copied to clipboard',
    });
  }
}
