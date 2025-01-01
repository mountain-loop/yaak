import type { AnalyticsAction, AnalyticsResource } from '../../src-tauri/bindings/analytics';
import { invokeCmd } from './tauri';

export function trackEvent(
  resource: AnalyticsResource,
  action: AnalyticsAction,
  attributes: Record<string, string | number> = {},
) {
  invokeCmd('cmd_track_event', {
    resource: resource,
    action,
    attributes,
  }).catch(console.error);
}
