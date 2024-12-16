import { emit } from '@tauri-apps/api/event';
import type { PromptTextRequest, PromptTextResponse } from '@yaakapp-internal/plugins';
import { useEnsureActiveCookieJar } from '../hooks/useActiveCookieJar';
import { useActiveWorkspaceChangedToast } from '../hooks/useActiveWorkspaceChangedToast';
import {useGenerateThemeCss} from "../hooks/useGenerateThemeCss";
import { useHotKey } from '../hooks/useHotKey';
import { useListenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { useNotificationToast } from '../hooks/useNotificationToast';
import { usePrompt } from '../hooks/usePrompt';
import { useRecentCookieJars } from '../hooks/useRecentCookieJars';
import { useRecentEnvironments } from '../hooks/useRecentEnvironments';
import { useRecentRequests } from '../hooks/useRecentRequests';
import { useRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import {useSyncFontSizeSetting} from "../hooks/useSyncFontSizeSetting";
import {useSyncModelStores} from "../hooks/useSyncModelStores";
import { useSyncWorkspaceChildModels } from '../hooks/useSyncWorkspaceChildModels';
import {useSyncZoomSetting} from "../hooks/useSyncZoomSetting";
import { useToggleCommandPalette } from '../hooks/useToggleCommandPalette';

export function GlobalHooks() {
  useSyncModelStores();
  useSyncZoomSetting();
  useSyncFontSizeSetting();
  useGenerateThemeCss();

  // Include here so they always update, even if no component references them
  useRecentWorkspaces();
  useRecentEnvironments();
  useRecentCookieJars();
  useRecentRequests();
  useSyncWorkspaceChildModels();

  // Other useful things
  useNotificationToast();
  useActiveWorkspaceChangedToast();
  useEnsureActiveCookieJar();

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
