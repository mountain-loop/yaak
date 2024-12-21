import type { MutationKey } from '@tanstack/react-query';
import { useCallback } from 'react';

export function useMutation<TData = unknown, TError = unknown, TVariables = void>({
  mutationKey,
  mutationFn,
  onSuccess,
  onSettled,
}: {
  mutationKey: MutationKey;
  mutationFn: (vars: TVariables) => Promise<TData>;
  onSettled?: () => void;
  onSuccess?: (data: TData) => void;
}) {
  const mutateAsync = useCallback(
    async (variables: TVariables) => {
      try {
        const data = await mutationFn(variables);
        onSuccess?.(data);
      } catch (err: unknown) {
        const e = err as TError;
        console.log('MUTATION FAILED', mutationKey, e);
      } finally {
        onSettled?.();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    mutationKey,
  );

  const mutate = useCallback(
    (variables: TVariables) => {
      setTimeout(() => mutateAsync(variables));
    },
    [mutateAsync],
  );

  return {
    mutate,
    mutateAsync,
  };
}
