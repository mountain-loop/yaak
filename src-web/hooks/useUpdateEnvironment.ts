import type { Environment } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai/index';
import { invokeCmd } from '../lib/tauri';
import { environmentsAtom, getEnvironment } from './useEnvironments';
import { useFastMutation } from './useFastMutation';
import { updateModelList } from './useSyncModelStores';

export function useUpdateEnvironment(id: string | null) {
  const setEnvironments = useSetAtom(environmentsAtom);
  return useFastMutation<
    Environment,
    unknown,
    Partial<Environment> | ((r: Environment) => Environment)
  >({
    mutationKey: ['update_environment', id],
    mutationFn: async (v) => {
      const environment = getEnvironment(id);
      if (environment == null) {
        throw new Error("Can't update a null environment");
      }

      const newEnvironment = typeof v === 'function' ? v(environment) : { ...environment, ...v };
      return invokeCmd<Environment>('cmd_update_environment', { environment: newEnvironment });
    },
    onSuccess: async (environment) => {
      setEnvironments(updateModelList(environment));
    },
  });
}
