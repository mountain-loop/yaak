import { emit } from '@tauri-apps/api/event';
import type { InternalEvent } from '@yaakapp-internal/plugins';
import type { ShowToastRequest } from '@yaakapp/api';
import { useSubscribeActiveWorkspaceId } from '../hooks/useActiveWorkspace';
import { useActiveWorkspaceChangedToast } from '../hooks/useActiveWorkspaceChangedToast';
import { useGenerateThemeCss } from '../hooks/useGenerateThemeCss';
import { useSubscribeHttpAuthentication } from '../hooks/useHttpAuthentication';
import { useListenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { useNotificationToast } from '../hooks/useNotificationToast';
import { useSyncFontSizeSetting } from '../hooks/useSyncFontSizeSetting';
import { useSyncModelStores } from '../hooks/useSyncModelStores';
import { useSyncWorkspaceChildModels } from '../hooks/useSyncWorkspaceChildModels';
import { useSyncZoomSetting } from '../hooks/useSyncZoomSetting';
import { useSubscribeTemplateFunctions } from '../hooks/useTemplateFunctions';
import { generateId } from '../lib/generateId';
import { showPrompt } from '../lib/prompt';
import { showToast } from '../lib/toast';

export function GlobalHooks() {
  useSyncModelStores();
  useSyncZoomSetting();
  useSyncFontSizeSetting();
  useGenerateThemeCss();

  useSubscribeActiveWorkspaceId();

  useSyncWorkspaceChildModels();
  useSubscribeTemplateFunctions();
  useSubscribeHttpAuthentication();

  // Other useful things
  useNotificationToast();
  useActiveWorkspaceChangedToast();

  // Listen for toasts
  useListenToTauriEvent<ShowToastRequest>('show_toast', (event) => {
    showToast({ ...event.payload });
  });

  // Listen for plugin events
  useListenToTauriEvent<InternalEvent>('plugin_event', async ({ payload: event }) => {
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

  return null;
}
