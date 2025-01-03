import { emit } from '@tauri-apps/api/event';
import type { PromptTextRequest, PromptTextResponse } from '@yaakapp-internal/plugins';
import {
  useEnsureActiveCookieJar,
  useSubscribeActiveCookieJarId,
} from '../hooks/useActiveCookieJar';
import { useSubscribeActiveEnvironmentId } from '../hooks/useActiveEnvironment';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { useSubscribeActiveRequestId } from '../hooks/useActiveRequestId';
import { useSubscribeActiveWorkspaceId } from '../hooks/useActiveWorkspace';
import { useActiveWorkspaceChangedToast } from '../hooks/useActiveWorkspaceChangedToast';
import { useDuplicateGrpcRequest } from '../hooks/useDuplicateGrpcRequest';
import { useDuplicateHttpRequest } from '../hooks/useDuplicateHttpRequest';
import { useGenerateThemeCss } from '../hooks/useGenerateThemeCss';
import { useHotKey } from '../hooks/useHotKey';
import { useListenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { useNotificationToast } from '../hooks/useNotificationToast';
import { usePrompt } from '../hooks/usePrompt';
import { useSubscribeRecentCookieJars } from '../hooks/useRecentCookieJars';
import { useSubscribeRecentEnvironments } from '../hooks/useRecentEnvironments';
import { useSubscribeRecentRequests } from '../hooks/useRecentRequests';
import { useSubscribeRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import { useSyncFontSizeSetting } from '../hooks/useSyncFontSizeSetting';
import { useSyncModelStores } from '../hooks/useSyncModelStores';
import { useSyncWorkspaceChildModels } from '../hooks/useSyncWorkspaceChildModels';
import { useSyncWorkspaceRequestTitle } from '../hooks/useSyncWorkspaceRequestTitle';
import { useSyncZoomSetting } from '../hooks/useSyncZoomSetting';
import { useSubscribeTemplateFunctions } from '../hooks/useTemplateFunctions';
import { useToggleCommandPalette } from '../hooks/useToggleCommandPalette';

export function GlobalHooks() {
  useSyncModelStores();
  useSyncZoomSetting();
  useSyncFontSizeSetting();
  useGenerateThemeCss();
  useSyncWorkspaceRequestTitle();

  useSubscribeActiveWorkspaceId();
  useSubscribeActiveRequestId();
  useSubscribeActiveEnvironmentId();
  useSubscribeActiveCookieJarId();

  useSubscribeRecentRequests();
  useSubscribeRecentWorkspaces();
  useSubscribeRecentEnvironments();
  useSubscribeRecentCookieJars();

  useSyncWorkspaceChildModels();
  useSubscribeTemplateFunctions();

  // Other useful things
  useNotificationToast();
  useActiveWorkspaceChangedToast();
  useEnsureActiveCookieJar();

  const activeRequest = useActiveRequest();
  const duplicateHttpRequest = useDuplicateHttpRequest({
    id: activeRequest?.id ?? null,
    navigateAfter: true,
  });
  const duplicateGrpcRequest = useDuplicateGrpcRequest({
    id: activeRequest?.id ?? null,
    navigateAfter: true,
  });
  useHotKey('http_request.duplicate', async () => {
    if (activeRequest?.model === 'http_request') {
      await duplicateHttpRequest.mutateAsync();
    } else {
      await duplicateGrpcRequest.mutateAsync();
    }
  });

  const toggleCommandPalette = useToggleCommandPalette();
  useHotKey('command_palette.toggle', toggleCommandPalette);

  const prompt = usePrompt();
  useListenToTauriEvent<{ replyId: string; args: PromptTextRequest }>(
    'show_prompt',
    async (event) => {
      const value = await prompt(event.payload.args);
      const result: PromptTextResponse = { value };
      await emit(event.payload.replyId, result);
    },
  );

  return null;
}
