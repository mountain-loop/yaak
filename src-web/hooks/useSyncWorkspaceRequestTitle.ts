import { setWindowTitle } from '@yaakapp-internal/mac-window';
import { settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { appInfo } from '../lib/appInfo';
import { jotaiStore } from '../lib/jotai';
import { resolvedModelName } from '../lib/resolvedModelName';
import { useActiveEnvironment } from './useActiveEnvironment';
import { activeRequestAtom } from './useActiveRequest';
import { activeWorkspaceAtom } from './useActiveWorkspace';

export function useSyncWorkspaceRequestTitle() {
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const activeEnvironment = useActiveEnvironment();
  const activeRequest = useAtomValue(activeRequestAtom);

  useEffect(() => {
    const settings = jotaiStore.get(settingsAtom);
    let newTitle = activeWorkspace ? activeWorkspace.name : 'Yaak';
    if (activeEnvironment) {
      newTitle += ` (${activeEnvironment.name})`;
    }

    if (!settings.useNativeTitlebar && activeRequest) {
      newTitle += ` › ${resolvedModelName(activeRequest)}`;
    }

    if (appInfo.isDev) {
      newTitle = `[DEV] ${newTitle}`;
    }

    setWindowTitle(newTitle);
  }, [activeEnvironment, activeRequest, activeWorkspace]);
}
