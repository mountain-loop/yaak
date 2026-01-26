import type { MutationKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import { showToast } from '../lib/toast';

interface MutationOptions<TData, TError, TVariables> {
  mutationKey: MutationKey;
  mutationFn: (vars: TVariables) => Promise<TData>;
  onSettled?: () => void;
  onError?: (err: TError) => void;
  onSuccess?: (data: TData) => void;
  disableToastError?: boolean;
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
    const { mutationKey, mutationFn, disableToastError } = {
      ...defaultArgs,
      ...args,
    };
    try {
      const data = await mutationFn(variables);
      // Run both default and custom onSuccess callbacks
      defaultArgs.onSuccess?.(data);
      args?.onSuccess?.(data);
      defaultArgs.onSettled?.();
      args?.onSettled?.();
      return data;
    } catch (err: unknown) {
      const stringKey = mutationKey.join('.');
      const e = err as TError;
      console.log('mutation error', stringKey, e);
      if (!disableToastError) {
        showToast({
          id: stringKey,
          message: `${err}`,
          color: 'danger',
          timeout: 5000,
        });
      }
      // Run both default and custom onError callbacks
      defaultArgs.onError?.(e);
      args?.onError?.(e);
      defaultArgs.onSettled?.();
      args?.onSettled?.();
      throw e;
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
    // biome-ignore lint/correctness/useExhaustiveDependencies: Force it!
  }, defaultArgs.mutationKey);
}
