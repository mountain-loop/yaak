import { emit } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { InternalEvent } from '@yaakapp-internal/plugins';
import type { ShowToastRequest } from '@yaakapp/api';
import { openSettings } from '../commands/openSettings';
import { Button } from '../components/core/Button';

// Listen for toasts
import { listenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { generateId } from './generateId';
import { showPrompt } from './prompt';
import { invokeCmd } from './tauri';
import { showToast } from './toast';

export function initGlobalListeners() {
  listenToTauriEvent<ShowToastRequest>('show_toast', (event) => {
    showToast({ ...event.payload });
  });

  listenToTauriEvent('settings', () => openSettings.mutate(null));

  // Listen for plugin events
  listenToTauriEvent<InternalEvent>('plugin_event', async ({ payload: event }) => {
    if (event.payload.type === 'prompt_text_request') {
      const value = await showPrompt(event.payload);
      const result: InternalEvent = {
        id: generateId(),
        replyId: event.id,
        pluginName: event.pluginName,
        pluginRefId: event.pluginRefId,
        windowContext: event.windowContext,
        payload: {
          type: 'prompt_text_response',
          value,
        },
      };
      await emit(event.id, result);
    }
  });

  listenToTauriEvent<{
    id: string;
    timestamp: string;
    message: string;
    timeout?: number | null;
    action?: null | {
      url: string;
      label: string;
    };
  }>('notification', ({ payload }) => {
    console.log('Got notification event', payload);
    const actionUrl = payload.action?.url;
    const actionLabel = payload.action?.label;
    showToast({
      id: payload.id,
      timeout: payload.timeout ?? undefined,
      message: payload.message,
      onClose: () => {
        invokeCmd('cmd_dismiss_notification', { notificationId: payload.id }).catch(console.error);
      },
      action: ({ hide }) =>
        actionLabel && actionUrl ? (
          <Button
            size="xs"
            color="secondary"
            className="mr-auto min-w-[5rem]"
            onClick={() => {
              hide();
              return openUrl(actionUrl);
            }}
          >
            {actionLabel}
          </Button>
        ) : null,
    });
  });
}
