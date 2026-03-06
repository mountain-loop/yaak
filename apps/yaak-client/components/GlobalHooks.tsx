import { activeRequestAtom } from '../hooks/useActiveRequest';
import { useSubscribeActiveWorkspaceId } from '../hooks/useActiveWorkspace';
import { useActiveWorkspaceChangedToast } from '../hooks/useActiveWorkspaceChangedToast';
import { useHotKey, useSubscribeHotKeys } from '../hooks/useHotKey';
import { useSubscribeHttpAuthentication } from '../hooks/useHttpAuthentication';
import { useSyncFontSizeSetting } from '../hooks/useSyncFontSizeSetting';
import { useSyncWorkspaceChildModels } from '../hooks/useSyncWorkspaceChildModels';
import { useSyncZoomSetting } from '../hooks/useSyncZoomSetting';
import { useSubscribeTemplateFunctions } from '../hooks/useTemplateFunctions';
import { jotaiStore } from '../lib/jotai';
import { renameModelWithPrompt } from '../lib/renameModelWithPrompt';

export function GlobalHooks() {
  useSyncZoomSetting();
  useSyncFontSizeSetting();

  useSubscribeActiveWorkspaceId();

  useSyncWorkspaceChildModels();
  useSubscribeTemplateFunctions();
  useSubscribeHttpAuthentication();

  // Other useful things
  useActiveWorkspaceChangedToast();
  useSubscribeHotKeys();

  useHotKey(
    'request.rename',
    async () => {
      const model = jotaiStore.get(activeRequestAtom);
      if (model == null) return;
      await renameModelWithPrompt(model);
    },
    { allowDefault: true },
  );

  return null;
}
