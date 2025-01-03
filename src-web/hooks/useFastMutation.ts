import type { MutationKey } from '@tanstack/react-query';
import { useMemo } from 'react';

interface MutationOptions<TData, TError, TVariables> {
  mutationKey: MutationKey;
  mutationFn: (vars: TVariables) => Promise<TData>;
  onSettled?: () => void;
  onError?: (err: TError) => void;
  onSuccess?: (data: TData) => void;
}

type CallbackMutationOptions<TData, TError, TVariables> = Omit<
  MutationOptions<TData, TError, TVariables>,
  'mutationKey' | 'mutationFn'
>;

export function createFastMutation<TData = unknown, TError = unknown, TVariables = void>(
  defaultArgs: MutationOptions<TData, TError, TVariables>,
) {
  const mutateAsync = async (
    variables: TVariables,
    args?: CallbackMutationOptions<TData, TError, TVariables>,
  ) => {
    const { mutationKey, mutationFn, onSuccess, onError, onSettled } = {
      ...defaultArgs,
      ...args,
    };
    try {
      const data = await mutationFn(variables);
      onSuccess?.(data);
      return data;
    } catch (err: unknown) {
      const e = err as TError;
      console.log('Fast mutation error', mutationKey, e);
      onError?.(e);
    } finally {
      onSettled?.();
    }
  };

  const mutate = (
    variables: TVariables,
    args?: CallbackMutationOptions<TData, TError, TVariables>,
  ) => {
    setTimeout(() => mutateAsync(variables, args));
  };

  return { mutateAsync, mutate };
}

export function useFastMutation<TData = unknown, TError = unknown, TVariables = void>(
  defaultArgs: MutationOptions<TData, TError, TVariables>,
) {
  return useMemo(() => {
    return createFastMutation(defaultArgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, defaultArgs.mutationKey);
}
