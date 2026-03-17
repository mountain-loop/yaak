import { type } from "@tauri-apps/plugin-os";

export type OsType = "linux" | "macos" | "windows";

export function getOsType(): OsType {
  try {
    const os = type();
    if (os === "linux" || os === "macos" || os === "windows") {
      return os;
    }
  } catch {
    // Non-Tauri context
  }

  return "linux";
}
