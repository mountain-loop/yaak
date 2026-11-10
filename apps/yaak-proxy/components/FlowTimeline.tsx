import type { Flow } from "@yaakapp-internal/proxy-lib";
import {
  CONTROL_TOOLTIP_DELAY,
  EventViewer,
  EventViewerRow,
  formatMillis,
  Icon,
  type IconProps,
  Tooltip,
} from "@yaakapp-internal/ui";
import { useMemo } from "react";
import { type FlowPhase, flowPhases, type PhaseKind } from "../lib/phases";

const ICONS: Record<PhaseKind, { icon: IconProps["icon"]; color: IconProps["color"] }> = {
  start: { icon: "send_horizontal", color: "secondary" },
  step: { icon: "arrow_right", color: "secondary" },
  end: { icon: "check", color: "success" },
  error: { icon: "alert_triangle", color: "danger" },
  cancelled: { icon: "circle_off", color: "secondary" },
};

/** Yaak's event list with the flow's phases as rows, each saying how long it took */
export function FlowTimeline({ flow }: { flow: Flow }) {
  const phases = useMemo(() => flowPhases(flow), [flow]);
  return (
    <EventViewer<FlowPhase>
      events={phases}
      getEventKey={(p) => p.key}
      splitLayoutStorageKey="proxy_flow_timeline"
      enableKeyboardNav={false}
      emptyMessage="No timings recorded"
      renderRow={({ event, isActive, onClick }) => {
        const { icon, color } = ICONS[event.kind];
        return (
          <EventViewerRow
            isActive={isActive}
            onClick={onClick}
            icon={<Icon icon={icon} color={color} size="sm" />}
            content={
              event.detail == null ? (
                <span>{event.label}</span>
              ) : (
                <Tooltip
                  wrap
                  content={event.detail}
                  delay={CONTROL_TOOLTIP_DELAY}
                >
                  <span>
                    {event.label}
                    <span className="text-text-subtlest">{` ${event.detail}`}</span>
                  </span>
                </Tooltip>
              )
            }
            columns="auto minmax(0,1fr) 6rem 6rem"
            cells={{
              trailing: [
                <span key="took" className="tabular-nums">
                  {event.kind === "start" ? "" : `+${formatMillis(event.tookMs)}`}
                </span>,
                <span key="at" className="tabular-nums opacity-50">
                  {formatMillis(event.atMs)}
                </span>,
              ],
            }}
          />
        );
      }}
    />
  );
}
