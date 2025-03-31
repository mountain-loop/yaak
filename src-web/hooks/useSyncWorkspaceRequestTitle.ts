import { emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';
import { resolvedModelName } from '../lib/resolvedModelName';
import { useActiveEnvironment } from './useActiveEnvironment';
import { activeRequestAtom } from './useActiveRequest';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { useAppInfo } from './useAppInfo';
import { useOsInfo } from './useOsInfo';

export function useSyncWorkspaceRequestTitle() {
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const activeEnvironment = useActiveEnvironment();
  const osInfo = useOsInfo();
  const appInfo = useAppInfo();

  useEffect(() => {
    if (osInfo.osType == null) {
      return;
    }

    let newTitle = activeWorkspace ? activeWorkspace.name : 'Yaak';
    if (activeEnvironment) {
      newTitle += ` [${activeEnvironment.name}]`;
    }
    const activeRequest = jotaiStore.get(activeRequestAtom);
    if (activeRequest) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      newTitle += ` › ${resolvedModelName(activeRequest)}`;
    }

    if (appInfo.isDev) {
      newTitle = `[DEV] ${newTitle}`;
    }

    // TODO: This resets the stoplight position so we can't use it on macOS yet. So we send
    //   a custom command instead
    if (osInfo.osType !== 'macos') {
      getCurrentWebviewWindow().setTitle(newTitle).catch(console.error);
    } else {
      emit('yaak_title_changed', newTitle).catch(console.error);
    }
  }, [activeEnvironment, activeWorkspace, appInfo.isDev, osInfo.osType]);
}
