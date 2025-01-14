import { emit } from '@tauri-apps/api/event';
import type { PromptTextRequest, PromptTextResponse } from '@yaakapp-internal/plugins';
import type { ShowToastRequest } from '@yaakapp/api';
import { useSubscribeActiveWorkspaceId } from '../hooks/useActiveWorkspace';
import { useActiveWorkspaceChangedToast } from '../hooks/useActiveWorkspaceChangedToast';
import { useGenerateThemeCss } from '../hooks/useGenerateThemeCss';
import { useListenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { useNotificationToast } from '../hooks/useNotificationToast';
import { useSyncFontSizeSetting } from '../hooks/useSyncFontSizeSetting';
import { useSyncModelStores } from '../hooks/useSyncModelStores';
import { useSyncWorkspaceChildModels } from '../hooks/useSyncWorkspaceChildModels';
import { useSyncZoomSetting } from '../hooks/useSyncZoomSetting';
import { useSubscribeTemplateFunctions } from '../hooks/useTemplateFunctions';
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

  // Other useful things
  useNotificationToast();
  useActiveWorkspaceChangedToast();

  // Listen for toasts
  useListenToTauriEvent<ShowToastRequest>('show_toast', (event) => {
    showToast({ ...event.payload });
  });

  // Listen for prompts
  useListenToTauriEvent<{ replyId: string; args: PromptTextRequest }>(
    'show_prompt',
    async (event) => {
      const value = await showPrompt(event.payload.args);
      const result: PromptTextResponse = { value };
      await emit(event.payload.replyId, result);
    },
  );

  return null;
}
