import type { Environment } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { getEnvironment } from './useEnvironments';
import { useFastMutation } from './useFastMutation';

export function useUpdateEnvironment(id: string | null) {
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
  });
}
