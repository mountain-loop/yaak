import type { TimelineViewMode } from '../components/HttpResponsePane';
import { useKeyValue } from './useKeyValue';

const DEFAULT_VIEW_MODE: TimelineViewMode = 'timeline';

export function useTimelineViewMode() {
  const { set, value } = useKeyValue<TimelineViewMode>({
    namespace: 'no_sync',
    key: 'timeline_view_mode',
    fallback: DEFAULT_VIEW_MODE,
  });

  return [value ?? DEFAULT_VIEW_MODE, set] as const;
}
