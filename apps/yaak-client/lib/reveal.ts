import { platform } from "@yaakapp-internal/platform";

const os = platform.osType();
export const revealInFinderText =
  os === "macos"
    ? "Reveal in Finder"
    : os === "windows"
      ? "Show in Explorer"
      : "Show in File Manager";
