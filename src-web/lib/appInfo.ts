import { getIdentifier } from '@tauri-apps/api/app';
import { invokeCmd } from './tauri';

export interface AppInfo {
  isDev: boolean;
  version: string;
  name: string;
  appDataDir: string;
  appLogDir: string;
  identifier: string;
  featureLicense: boolean;
  featureUpdater: boolean;
}

export const appInfo = {
  ...(await invokeCmd('cmd_metadata')),
  identifier: await getIdentifier(),
} as AppInfo;

console.log('App info', appInfo);
