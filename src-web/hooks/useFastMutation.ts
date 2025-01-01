import type { MutationKey } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from './useToast';

export function useFastMutation<TData = unknown, TError = unknown, TVariables = void>({
  mutationKey,
  mutationFn,
  onSuccess,
  onError,
  onSettled,
  toastyError,
}: {
  mutationKey: MutationKey;
  mutationFn: (vars: TVariables) => Promise<TData>;
  onSettled?: () => void;
  onError?: (err: TError) => void;
  onSuccess?: (data: TData) => void;
  toastyError?: boolean;
}) {
  const toast = useToast();

  const mutateAsync = useCallback(
    async (variables: TVariables) => {
      try {
        const data = await mutationFn(variables);
        onSuccess?.(data);
        return data;
      } catch (err: unknown) {
        const e = err as TError;
        console.log('Fast mutation error', mutationKey, e);
        onError?.(e);
        if (toastyError) {
          toast.show({
            id: 'error-' + mutationKey.join('.'),
            color: 'danger',
            timeout: 8000,
            message: String(e),
          });
        }
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
