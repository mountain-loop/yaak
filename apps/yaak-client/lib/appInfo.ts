import { platform } from "@yaakapp-internal/platform";
import { rpc } from "./rpc";

export interface AppInfo {
  isDev: boolean;
  version: string;
  cliVersion: string | null;
  name: string;
  appDataDir: string;
  appLogDir: string;
  vendoredPluginDir: string;
  defaultProjectDir: string;
  identifier: string;
  featureLicense: boolean;
  featureUpdater: boolean;
}

export const appInfo = {
  ...(await rpc("cmd_metadata")),
  identifier: await platform.appIdentifier(),
} as AppInfo;

console.log("App info", appInfo);
