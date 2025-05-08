import type { Environment } from '@yaakapp-internal/models';
import { createWorkspaceModel } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { showPrompt } from '../lib/prompt';
import { setWorkspaceSearchParams } from '../lib/setWorkspaceSearchParams';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateEnvironment() {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);

  return useFastMutation<string | null, unknown, Environment | null>({
    mutationKey: ['create_environment', workspaceId],
    mutationFn: async (baseEnvironment) => {
      if (baseEnvironment == null) {
        throw new Error('No base environment passed');
      }

      if (workspaceId == null) {
        throw new Error('Cannot create environment when no active workspace');
      }

      const name = await showPrompt({
        id: 'new-environment',
        title: 'New Environment',
        description: 'Create multiple environments with different sets of variables',
        label: 'Name',
        placeholder: 'My Environment',
        defaultValue: 'My Environment',
        confirmText: 'Create',
      });
      if (name == null) return null;

      return createWorkspaceModel({
        model: 'environment',
        name,
        variables: [],
        workspaceId,
        base: false,
      });
    },
    onSuccess: async (environmentId) => {
      if (environmentId == null) {
        return; // Was not created
      }

      setWorkspaceSearchParams({ environment_id: environmentId });
    },
  });
}
