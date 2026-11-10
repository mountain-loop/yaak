import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import { DetailsBanner, formatMillis, KeyValueRow, KeyValueRows } from "@yaakapp-internal/ui";
import { format } from "date-fns";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { utcTimestamp } from "../lib/flowViews";
import { folderOf } from "../lib/search";
import { AppIcon } from "./AppIcon";

/**
 * Where a flow came from and how it travelled: in a proxy you didn't send the request, so the
 * connection on each leg, the app and its process, timing, sizes and the flow's record are part
 * of the answer.
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
    </div>
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
