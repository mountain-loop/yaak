import type { Environment } from '@yaakapp-internal/models';
import { createWorkspaceModel } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { showPrompt } from '../lib/prompt';
import { setWorkspaceSearchParams } from '../lib/setWorkspaceSearchParams';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateEnvironment() {
  return useFastMutation<string, unknown, Environment | null>({
    mutationKey: ['create_environment'],
    mutationFn: async (baseEnvironment) => {
      if (baseEnvironment == null) {
        throw new Error('No base environment passed');
      }

      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
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
      if (name == null) throw new Error('No name provided to create environment');

      return createWorkspaceModel({
        model: 'environment',
        name,
        variables: [],
        workspaceId,
        environmentId: baseEnvironment.id,
      });
    },
    onSuccess: async (environmentId) => {
      setWorkspaceSearchParams({ environment_id: environmentId });
    },
  });
}
