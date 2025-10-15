import { useSubscribeActiveWorkspaceId } from '../hooks/useActiveWorkspace';
import { useActiveWorkspaceChangedToast } from '../hooks/useActiveWorkspaceChangedToast';
import { useSubscribeHotKeys } from '../hooks/useHotKey';
import { useSubscribeHttpAuthentication } from '../hooks/useHttpAuthentication';
import { useSyncFontSizeSetting } from '../hooks/useSyncFontSizeSetting';
import { useSyncWorkspaceChildModels } from '../hooks/useSyncWorkspaceChildModels';
import { useSyncZoomSetting } from '../hooks/useSyncZoomSetting';
import { useSubscribeTemplateFunctions } from '../hooks/useTemplateFunctions';

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

  return null;
}
