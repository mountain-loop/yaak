import type { Environment } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { showPrompt } from '../lib/prompt';
import { setWorkspaceSearchParams } from '../lib/setWorkspaceSearchParams';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateEnvironment() {
  return useFastMutation<Environment | null, unknown, Environment | null>({
    mutationKey: ['create_environment'],
    mutationFn: async (baseEnvironment) => {
      if (baseEnvironment == null) {
        throw new Error('No base environment passed');
      }

      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
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

      return invokeCmd('cmd_create_environment', {
        name,
        variables: [],
        workspaceId,
        environmentId: baseEnvironment.id,
      });
    },
    onSuccess: async (environment) => {
      if (environment == null) return;
      setWorkspaceSearchParams({ environment_id: environment.id });
    },
  });
}
