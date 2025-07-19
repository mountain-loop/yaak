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
  if (workspaceId == null) return;
  showDialog({
    id: 'workspace-settings',
    title: 'Workspace Settings',
    size: 'md',
    className: 'h-[calc(100vh-5rem)] max-h-[40rem]',
    noPadding: true,
    render: ({ hide }) => (
      <WorkspaceSettingsDialog workspaceId={workspaceId} hide={hide} tab={tab} />
    ),
  });
}
