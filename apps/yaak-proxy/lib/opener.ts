import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

/** Says what failed, as a toast, rather than leaving a button that does nothing */
export type ReportFailure = (message: string) => void;

/** Shows a file or folder in the platform's file manager */
export async function revealPath(path: string, report: ReportFailure): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch (err) {
    report(`Failed to show ${path}: ${String(err)}`);
  }
}

/** Opens a link in the default browser */
export async function openLink(url: string, report: ReportFailure): Promise<void> {
  try {
    await openUrl(url);
  } catch (err) {
    report(`Failed to open ${url}: ${String(err)}`);
  }
}

/** What the platform calls showing a file in its file manager */
export function revealLabel(os: string): string {
  if (os === "macos") return "Reveal in Finder";
  if (os === "windows") return "Show in Explorer";
  return "Show in Folder";
}
