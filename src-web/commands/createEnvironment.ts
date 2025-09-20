import { createWorkspaceModel, type Environment } from '@yaakapp-internal/models';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { jotaiStore } from '../lib/jotai';
import { showPrompt } from '../lib/prompt';
import { setWorkspaceSearchParams } from '../lib/setWorkspaceSearchParams';

export const createEnvironmentAndActivate = createFastMutation<
  string | null,
  unknown,
  Environment | null
>({
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
    if (name == null) return null;

    return createWorkspaceModel({
      model: 'environment',
      name,
      variables: [],
      workspaceId,
      parentId: baseEnvironment.id,
      parentModel: 'environment',
    });
  },
  onSuccess: async (environmentId) => {
    if (environmentId == null) {
      return; // Was not created
    }

    console.log('NAVIGATING', jotaiStore.get(activeWorkspaceIdAtom), environmentId);
    setWorkspaceSearchParams({ environment_id: environmentId });
  },
});
