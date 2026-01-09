import { useAtomValue } from 'jotai';
import { activeEnvironmentAtom } from './useActiveEnvironment';
import { useEnvironmentVariables } from './useEnvironmentVariables';

export function useActiveEnvironmentVariables() {
  const activeEnvironment = useAtomValue(activeEnvironmentAtom);
  return useEnvironmentVariables(activeEnvironment?.id ?? null).map((v) => v.variable);
}
