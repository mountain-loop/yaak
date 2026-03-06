import { type } from '@tauri-apps/plugin-os';

const os = type();
export const revealInFinderText =
  os === 'macos'
    ? 'Reveal in Finder'
    : os === 'windows'
      ? 'Show in Explorer'
      : 'Show in File Manager';
