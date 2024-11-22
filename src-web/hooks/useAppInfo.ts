import { invokeCmd } from '../lib/tauri';

export interface AppInfo {
  isDev: boolean;
  version: string;
  name: string;
  appDataDir: string;
  appLogDir: string;
}

export const appInfo = (await invokeCmd('cmd_metadata')) as AppInfo;

export function useAppInfo() {
  return appInfo;
}
