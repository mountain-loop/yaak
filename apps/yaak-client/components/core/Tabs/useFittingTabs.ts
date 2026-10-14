import { useLayoutEffect, useRef, useState } from "react";
import { fitTabs, MIN_TAB_GAP_SCALE, MIN_TAB_PADDING_SCALE } from "./fitTabs";

export function useFittingTabs(enabled: boolean, activeValue?: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const measurementsRef = useRef<HTMLDivElement>(null);
  const [fittedTabs, setFittedTabs] = useState<ReturnType<typeof fitTabs> | null>(null);

  // Reobserve after render: tab labels, badges and available tabs can all change.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const measurements = measurementsRef.current;
    if (!enabled || !viewport || !measurements) return;

    const measure = () => {
      const widths = Array.from(measurements.children, (child) => {
        const width = child.getBoundingClientRect().width;
        const button = child.querySelector("button");
        const buttonStyle = button ? getComputedStyle(button) : null;
        const padding = buttonStyle
          ? Number.parseFloat(buttonStyle.paddingLeft) + Number.parseFloat(buttonStyle.paddingRight)
          : 0;
        const gap = child.firstElementChild
          ? Number.parseFloat(getComputedStyle(child.firstElementChild).marginRight)
          : 0;
        const compactWidth =
          width - padding * (1 - MIN_TAB_PADDING_SCALE) - gap * (1 - MIN_TAB_GAP_SCALE);
        return {
          value: child.getAttribute("data-measure-tab") ?? "",
          width,
          compactWidth,
        };
      });
      const next = fitTabs(widths, viewport.clientWidth, activeValue);
      setFittedTabs((previous) =>
        previous?.length === next.length &&
        previous.every(
          (tab, i) =>
            tab.value === next[i]?.value &&
            tab.width === next[i]?.width &&
            tab.spacingCompression === next[i]?.spacingCompression,
        )
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    for (const child of measurements.children) observer.observe(child);
    return () => observer.disconnect();
  });

  return { viewportRef, measurementsRef, fittedTabs: enabled ? fittedTabs : null };
}
