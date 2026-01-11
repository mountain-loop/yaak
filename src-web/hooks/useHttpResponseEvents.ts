import { invoke } from '@tauri-apps/api/core';
import type { HttpResponse, HttpResponseEvent } from '@yaakapp-internal/models';
import {
  httpResponseEventsAtom,
  mergeModelsInStore,
  replaceModelsInStore,
} from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo } from 'react';

export function useHttpResponseEvents(response: HttpResponse | null) {
  const allEvents = useAtomValue(httpResponseEventsAtom);

  useEffect(() => {
    if (response?.id == null) {
      replaceModelsInStore('http_response_event', []);
      return;
    }

    // Use merge instead of replace to preserve events that came in via model_write
    // while we were fetching from the database
    invoke<HttpResponseEvent[]>('cmd_get_http_response_events', { responseId: response.id }).then(
      (events) => mergeModelsInStore('http_response_event', events),
    );
  }, [response?.id]);

  // Filter events for the current response
  const events = useMemo(
    () => allEvents.filter((e) => e.responseId === response?.id),
    [allEvents, response?.id],
  );

  return { data: events, error: null, isLoading: false };
}
