
export function isSidebarFocused() {
  return document.activeElement?.closest('.x-theme-sidebar') != null;
}
