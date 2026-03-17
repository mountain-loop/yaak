import { getOsType } from "./os";

const os = getOsType();
export const revealInFinderText =
  os === "macos"
    ? "Reveal in Finder"
    : os === "windows"
      ? "Show in Explorer"
      : "Show in File Manager";
