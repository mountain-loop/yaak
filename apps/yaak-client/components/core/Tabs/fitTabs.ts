export const MIN_TAB_PADDING_SCALE = 0.5;
export const MIN_TAB_GAP_SCALE = 0.25;

export interface TabWidth {
  value: string;
  width: number;
  /** Full label and badges, with the smallest padding and gap. */
  compactWidth: number;
}

/** Tighten spacing to fit whole tabs, keeping every visible label intact. */
export function fitTabs(
  tabs: TabWidth[],
  availableWidth: number,
  activeValue?: string,
): { value: string; width: number; spacingCompression: number }[] {
  const available = Math.max(0, availableWidth);
  // Even the active tab goes into overflow if it cannot fit on its own.
  const active = tabs.find((tab) => tab.value === activeValue && tab.compactWidth <= available);
  let remaining = available - (active?.compactWidth ?? 0);
  const fitted = new Set(active ? [active.value] : []);
  for (const tab of tabs) {
    if (tab === active) continue;
    if (tab.compactWidth > remaining) break;
    fitted.add(tab.value);
    remaining -= tab.compactWidth;
  }
  const visible = tabs.filter((tab) => fitted.has(tab.value));
  const naturalWidth = visible.reduce((sum, tab) => sum + tab.width, 0);
  const deficit = Math.max(0, naturalWidth - available);
  const spareSpacing = visible.reduce((sum, tab) => sum + tab.width - tab.compactWidth, 0);
  const spacingCompression = spareSpacing > 0 ? Math.min(1, deficit / spareSpacing) : 0;
  return visible.map((tab) => ({
    value: tab.value,
    spacingCompression,
    width: tab.width - spacingCompression * (tab.width - tab.compactWidth),
  }));
}
