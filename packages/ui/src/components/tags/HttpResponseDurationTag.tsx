import type { HttpResponse } from "@yaakapp-internal/models";
import { useEffect, useRef, useState } from "react";

interface Props {
  response: HttpResponse;
}

export function HttpResponseDurationTag({ response }: Props) {
  return (
    <HttpResponseDurationTagRaw
      closed={response.state === "closed"}
      startedAt={`${response.createdAt}Z`}
      elapsedMs={response.elapsed}
      elapsedHeadersMs={response.elapsedHeaders}
      elapsedDnsMs={response.elapsedDns}
    />
  );
}

interface RawProps {
  /** Whether the response has ended; until then the time counts up from `startedAt` */
  closed: boolean;
  /** When the request started, as an ISO 8601 string with its zone */
  startedAt: string;
  elapsedMs: number;
  elapsedHeadersMs: number;
  elapsedDnsMs: number;
}

export function HttpResponseDurationTagRaw({
  closed,
  startedAt,
  elapsedMs,
  elapsedHeadersMs,
  elapsedDnsMs,
}: RawProps) {
  const [fallbackElapsed, setFallbackElapsed] = useState<number>(0);
  const timeout = useRef<ReturnType<typeof setInterval>>(undefined);

  // Calculate the duration of the response for use when the response hasn't finished yet
  useEffect(() => {
    clearInterval(timeout.current);
    if (closed) return;
    timeout.current = setInterval(() => {
      setFallbackElapsed(Date.now() - new Date(startedAt).getTime());
    }, 100);
    return () => clearInterval(timeout.current);
  }, [startedAt, closed]);

  const dnsValue = elapsedDnsMs > 0 ? formatMillis(elapsedDnsMs) : "--";
  const title = `DNS: ${dnsValue}\nHEADER: ${formatMillis(elapsedHeadersMs)}\nTOTAL: ${formatMillis(elapsedMs)}`;

  const elapsed = closed ? elapsedMs : fallbackElapsed;

  return (
    <span className="font-mono" title={title}>
      {formatMillis(elapsed)}
    </span>
  );
}

export function formatMillis(ms: number) {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60_000) {
    const seconds = (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);
    return `${seconds} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
