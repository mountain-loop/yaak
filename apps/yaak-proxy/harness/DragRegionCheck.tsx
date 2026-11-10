import { useEffect, useState } from "react";

interface Probe {
  x: number;
  y: number;
  kind: "drag" | "control" | "dead";
}

/**
 * Dev only, with `?window&dragcheck`: probes the header across its width and marks what a press
 * at each point lands on. Green drags the window (the element hit carries
 * `data-tauri-drag-region`, which Tauri reads off the target alone), blue is a control, and red
 * is dead space that neither drags nor does anything.
 */
export function DragRegionCheck() {
  const [probes, setProbes] = useState<Probe[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const header = document.querySelector<HTMLElement>(".x-theme-appHeader");
      if (header == null) return;
      const rect = header.getBoundingClientRect();
      const out: Probe[] = [];
      for (const y of [rect.top + 6, rect.top + rect.height / 2]) {
        for (let x = rect.left + 4; x < rect.right; x += 10) {
          const el = document.elementFromPoint(x, y);
          const kind =
            el == null
              ? "dead"
              : el.hasAttribute("data-tauri-drag-region")
                ? "drag"
                : el.closest("button, input, [role=button], .cm-editor, [role=combobox]") != null
                  ? "control"
                  : "dead";
          out.push({ x, y, kind });
        }
      }
      setProbes(out);
    }, 800);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {probes.map((p) => (
        <span
          key={`${p.x}:${p.y}`}
          className="absolute size-1.5 -ml-[3px] -mt-[3px] rounded-full"
          style={{
            left: p.x,
            top: p.y,
            background:
              p.kind === "drag" ? "#22c55e" : p.kind === "control" ? "#3b82f6" : "#ef4444",
          }}
        />
      ))}
    </div>
  );
}
