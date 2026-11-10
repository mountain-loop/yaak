import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import {
  CONTROL_TOOLTIP_DELAY,
  DetailsBanner,
  formatMillis,
  Icon,
  type IconProps,
  KeyValueRow,
  KeyValueRows,
  Tooltip,
} from "@yaakapp-internal/ui";
import { format } from "date-fns";
import { Fragment, type HTMLAttributes, type ReactElement, type ReactNode, useMemo } from "react";
import { utcTimestamp } from "../lib/flowViews";
import { flowPhases, type PhaseKind } from "../lib/phases";
import { folderOf } from "../lib/search";
import { AppIcon } from "./AppIcon";

/**
 * Where a flow came from and how it travelled: in a proxy you didn't send the request, so the
 * connection on each leg, the app and its process, timing, sizes and the flow's record are part
 * of the answer. Then the timeline: each phase of the exchange and how long it took.
 */
export function FlowInfo({ flow }: { flow: Flow }) {
  const folder = folderOf(flow);
  const clientPort = portOf(flow.clientAddr);

  return (
    <div className="overflow-auto h-full pb-4 gap-y-3 flex flex-col pr-0.5">
      <Section title="Connection">
        {[
          row("remote", "Remote Address", flow.remoteAddr, { copy: true }),
          row("client_version", "Client Version", flow.clientHttpVersion),
          row("server_version", "Server Version", flow.upstreamHttpVersion),
          row("tls", "TLS", flow.upstreamTlsVersion),
          row("cipher", "Cipher", flow.upstreamTlsCipher),
          row("client_port", "Client Port", clientPort),
        ]}
      </Section>
      <Section title="App">
        {[
          row(
            "app",
            "Name",
            flow.clientName == null ? null : (
              <span className="flex items-center gap-1.5">
                {flow.clientPath != null && <AppIcon path={flow.clientPath} className="size-5" />}
                {flow.clientName}
                {folder != null && <span className="text-text-subtlest">{folder}</span>}
              </span>
            ),
          ),
          flow.clientBundleId != null
            ? row("bundle", "Bundle ID", flow.clientBundleId, { copy: true })
            : row("path", "Path", flow.clientPath, { copy: true }),
          row("pid", "PID", flow.clientPid == null ? null : `${flow.clientPid}`),
          row("cwd", "Directory", flow.clientCwd, { copy: true }),
        ]}
      </Section>
      <Section title="Timing">
        {[
          row(
            "started",
            "Started",
            format(utcTimestamp(flow.startedAt), "MMM d, yyyy, h:mm:ss.SSS a"),
          ),
          row("headers", "Headers", ms(flow.elapsedHeadersMs)),
          row("total", "Total", ms(flow.elapsedMs)),
        ]}
      </Section>
      <Section title="Size">
        {[
          row("request_size", "Request", formatSize(flow.requestSize)),
          row("response_size", "Response", formatSize(flow.responseSize)),
        ]}
      </Section>
      <Section title="Record">
        {[
          row("number", "Number", `#${flow.number}`, { copy: true }),
          row("id", "ID", flow.id, { copy: true }),
          row("saved", "Saved As", flow.savedRequestId, { copy: true }),
        ]}
      </Section>
      <Timeline flow={flow} />
    </div>
  );
}

const PHASE_ICONS: Record<PhaseKind, { icon: IconProps["icon"]; color: IconProps["color"] }> = {
  start: { icon: "send_horizontal", color: "secondary" },
  step: { icon: "arrow_right", color: "secondary" },
  end: { icon: "check", color: "success" },
  error: { icon: "alert_triangle", color: "danger" },
  cancelled: { icon: "circle_off", color: "secondary" },
};

/** The flow's phases, each with how long it took and when, from the start */
function Timeline({ flow }: { flow: Flow }) {
  const phases = useMemo(() => flowPhases(flow), [flow]);
  if (phases.length === 0) return null;
  return (
    <DetailsBanner defaultOpen summary={<h2>Timeline</h2>}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center text-sm py-1">
        {phases.map((p) => {
          const { icon, color } = PHASE_ICONS[p.kind];
          return (
            <Fragment key={p.key}>
              <Icon icon={icon} color={color} size="sm" />
              {p.detail == null ? (
                <span className="truncate">{p.label}</span>
              ) : (
                <Tooltip wrap content={p.detail} delay={CONTROL_TOOLTIP_DELAY}>
                  <span className="truncate">
                    {p.label}
                    <span className="text-text-subtlest">{` ${p.detail}`}</span>
                  </span>
                </Tooltip>
              )}
              <span className="font-mono text-xs tabular-nums text-right">
                {p.kind === "start" ? "" : `+${formatMillis(p.tookMs)}`}
              </span>
              <span className="font-mono text-xs tabular-nums text-right text-text-subtlest">
                {formatMillis(p.atMs)}
              </span>
            </Fragment>
          );
        })}
      </div>
    </DetailsBanner>
  );
}

/** A row as `KeyValueRows` takes it */
type Row = ReactElement<HTMLAttributes<HTMLTableColElement>>;

function Section({ title, children }: { title: string; children: (Row | null)[] }) {
  const rows = children.filter((r): r is Row => r != null);
  if (rows.length === 0) return null;
  return (
    <DetailsBanner defaultOpen summary={<h2>{title}</h2>}>
      <KeyValueRows>{rows}</KeyValueRows>
    </DetailsBanner>
  );
}

/** A row, or nothing when there's no value for it */
function row(
  key: string,
  label: string,
  value: ReactNode | null | undefined,
  opts: { copy?: boolean } = {},
): Row | null {
  if (value == null || value === "") return null;
  return (
    <KeyValueRow
      key={key}
      labelColor="secondary"
      label={label}
      enableCopy={opts.copy}
      copy={copyText}
    >
      {value}
    </KeyValueRow>
  );
}

function ms(value: number | null): string | null {
  return value == null ? null : formatMillis(value);
}

/** The port of `127.0.0.1:54321` or `[::1]:54321` */
export function portOf(addr: string | null | undefined): string | null {
  const port = addr?.match(/:(\d+)$/)?.[1];
  return port ?? null;
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(console.error);
}
