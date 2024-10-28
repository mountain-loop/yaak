import { useMutation } from '@tanstack/react-query';
import type { Environment } from '@yaakapp-internal/models';
import {useSetAtom} from "jotai";
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { useActiveEnvironment } from './useActiveEnvironment';
import { useActiveWorkspace } from './useActiveWorkspace';
import {environmentsAtom} from "./useEnvironments";
import { usePrompt } from './usePrompt';
import {updateModelList} from "./useSyncModelStores";

export function useCreateEnvironment() {
  const [, setActiveEnvironmentId] = useActiveEnvironment();
  const prompt = usePrompt();
  const workspace = useActiveWorkspace();
  const setEnvironments = useSetAtom(environmentsAtom);

  return useMutation<Environment | null, unknown, void>({
    mutationKey: ['create_environment'],
    mutationFn: async () => {
      const name = await prompt({
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
        workspaceId: workspace?.id,
      });
    },
    onSettled: () => trackEvent('environment', 'create'),
    onSuccess: async (environment) => {
      if (environment == null) return;

      // Optimistic update
      setEnvironments(updateModelList(environment));

      setActiveEnvironmentId(environment.id);
    },
  });
}
