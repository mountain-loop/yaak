import { format } from "date-fns";
import { formatMillis } from "../tags/HttpResponseDurationTag";

/**
 * What the event stream viewer draws. Each app maps its own records onto these (the client the
 * events of an SSE response, the proxy a stream's stored messages), so the viewer never imports
 * either app's model types.
 */

/** Which side sent it: the app, the server, or neither, as a connection's status */
export type StreamEventDirection = "sent" | "received" | "info";

export interface StreamEvent {
  /** Unique within the stream, and stable as more events arrive */
  key: string;
  direction: StreamEventDirection;
  /** What kind it is, as its type column shows it: `text`, `close`, an SSE event's name */
  kind: string | null;
  /** Small chips before the preview, as the client's SSE event ids */
  labels?: string[];
  /** When it passed, in UTC without a zone (`2026-11-06T09:30:00.123`), as the models store it */
  timestamp: string | null;
  /** Bytes on the wire */
  size: number | null;
  /** The start of the payload as text, null when it's binary or empty */
  preview: string | null;
  /** In place of the preview, dimmed: a close's code and reason, a call's status */
  note?: string | null;
  /** The detail's title, like `Connection Closed`; by direction when not given */
  title?: string;
  /** Its payload is binary, so the detail opens on the hexdump */
  binary?: boolean;
  /** Its payload was cut at the capture limit */
  truncated?: boolean;
  /** Why its payload could not be read */
  error?: string | null;
  /** Coloured as a warning, as an error or a failed status */
  warning?: boolean;
}

/** A way of showing an event's payload, as its body view's switch offers them */
export type StreamPayloadView =
  | {
      value: string;
      label: string;
      /** Text, with the language it's highlighted and formatted as */
      type: "text";
      load: () => Promise<StreamPayloadText>;
    }
  | { value: string; label: string; type: "hexdump" };

export interface StreamPayloadText {
  text: string;
  language: "json" | "text";
  /** Shown above the text, as how a gRPC message was decoded */
  note?: string | null;
}

/** An event's payload */
export interface StreamPayload {
  bytes: Uint8Array;
}

/** Milliseconds from each event to the one before it, null for the first or an undated one */
export function eventDeltas(events: Pick<StreamEvent, "timestamp">[]): (number | null)[] {
  let previous: number | null = null;
  return events.map((event) => {
    const at = parseTimestamp(event.timestamp);
    const delta = at == null || previous == null ? null : Math.max(0, at - previous);
    if (at != null) previous = at;
    return delta;
  });
}

/** A delta as its column shows it: `+12 ms`, `+1.5 s` */
export function formatEventDelta(delta: number | null): string {
  return delta == null ? "" : `+${formatMillis(Math.round(delta))}`;
}

/** An event's time of day, to the millisecond, in the local zone */
export function formatEventTime(timestamp: string | null): string {
  const at = parseTimestamp(timestamp);
  return at == null ? "" : format(at, "HH:mm:ss.SSS");
}

function parseTimestamp(timestamp: string | null): number | null {
  if (timestamp == null) return null;
  const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`);
  return Number.isNaN(at) ? null : at;
}
