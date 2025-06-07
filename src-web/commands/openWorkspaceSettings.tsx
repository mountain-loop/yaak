import type {
  WorkspaceSettingsTab} from '../components/WorkspaceSettingsDialog';
import {
  WorkspaceSettingsDialog
} from '../components/WorkspaceSettingsDialog';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';

export function openWorkspaceSettings(tab?: WorkspaceSettingsTab) {
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  showDialog({
    id: 'workspace-settings',
    title: 'Workspace Settings',
    size: 'lg',
    className: 'h-[50rem]',
    noPadding: true,
    render({ hide }) {
      return <WorkspaceSettingsDialog workspaceId={workspaceId} hide={hide} tab={tab} />;
    },
  });
}
