import { getOsType } from "./os";

const os = getOsType();
export const revealInFinderText =
  os === "macos"
    ? "Показать в Finder"
    : os === "windows"
      ? "Показать в Проводнике"
      : "Показать в файловом менеджере";
