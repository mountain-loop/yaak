import { useCallback } from 'react';
import { CreateWorkspaceDialog } from '../components/CreateWorkspaceDialog';
import { useDialog } from './useDialog';

export function useCreateWorkspace() {
  const dialog = useDialog();

  return useCallback(() => {
    dialog.show({
      id: 'create-workspace',
      title: 'Create Workspace',
      size: 'md',
      render: ({ hide }) => <CreateWorkspaceDialog hide={hide} />,
    });
  }, [dialog]);
}
