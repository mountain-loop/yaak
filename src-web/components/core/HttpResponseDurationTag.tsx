import type { HttpResponse } from '@yaakapp-internal/models';
import { useEffect, useRef, useState } from 'react';

interface Props {
  response: HttpResponse;
}

export function HttpResponseDurationTag({ response }: Props) {
  const [fallbackElapsed, setFallbackElapsed] = useState<number>(0);
  const timeout = useRef<NodeJS.Timeout>(undefined);

  // Calculate the duration of the response for use when the response hasn't finished yet
  useEffect(() => {
    clearInterval(timeout.current);
    if (response.state === 'closed') return;
    timeout.current = setInterval(() => {
      setFallbackElapsed(Date.now() - new Date(response.createdAt + 'Z').getTime());
    }, 100);
    return () => clearInterval(timeout.current);
  }, [response.createdAt, response.elapsed, response.state]);

  const title = `HEADER: ${formatMillis(response.elapsedHeaders)}\nTOTAL: ${formatMillis(response.elapsed)}`;

  const elapsed = response.state === 'closed' ? response.elapsed : fallbackElapsed;

  return (
    <span className="font-mono" title={title}>
      {formatMillis(elapsed)}
    </span>
  );
}

function formatMillis(ms: number) {
  if (ms < 1000) {
    return `${ms} ms`;
  } else if (ms < 60_000) {
    const seconds = (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);
    return `${seconds} s`;
  } else {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
