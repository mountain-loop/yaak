import { invoke } from '@tauri-apps/api/core';
import type { HttpResponse, HttpResponseEvent } from '@yaakapp-internal/models';
import {
  httpResponseEventsAtom,
  mergeModelsInStore,
  replaceModelsInStore,
} from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useEffect } from 'react';

export function useHttpResponseEvents(response: HttpResponse | null) {
  const allEvents = useAtomValue(httpResponseEventsAtom);

  useEffect(() => {
    if (response?.id == null) {
      replaceModelsInStore('http_response_event', []);
      return;
    }

    // Fetch events from database, filtering out events from other responses and merging atomically
    invoke<HttpResponseEvent[]>('cmd_get_http_response_events', { responseId: response.id }).then(
      (events) =>
        mergeModelsInStore('http_response_event', events, (e) => e.responseId === response.id),
    );
  }, [response?.id]);

  const events = allEvents.filter((e) => e.responseId === response?.id);
  return { data: events, error: null, isLoading: false };
}
