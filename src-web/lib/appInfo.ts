import { getIdentifier } from '@tauri-apps/api/app';
import { invokeCmd } from './tauri';

export interface AppInfo {
  isDev: boolean;
  version: string;
  name: string;
  appDataDir: string;
  appLogDir: string;
  identifier: string;
}

export const appInfo = {
  ...(await invokeCmd('cmd_metadata')),
  identifier: await getIdentifier(),
} as AppInfo;
