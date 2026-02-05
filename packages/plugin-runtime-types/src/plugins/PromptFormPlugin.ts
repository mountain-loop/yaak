import type { FormInput, JsonPrimitive } from '../bindings/gen_events';
import type { MaybePromise } from '../helpers';
import type { Context } from './Context';

export type CallPromptFormDynamicArgs = {
  values: { [key in string]?: JsonPrimitive };
};

type AddDynamicMethod<T> = {
  dynamic?: (
    ctx: Context,
    args: CallPromptFormDynamicArgs,
  ) => MaybePromise<Partial<T> | null | undefined>;
};

// biome-ignore lint/suspicious/noExplicitAny: distributive conditional type pattern
type AddDynamic<T> = T extends any
  ? T extends { inputs?: FormInput[] }
    ? Omit<T, 'inputs'> & {
        inputs: Array<AddDynamic<FormInput>>;
        dynamic?: (
          ctx: Context,
          args: CallPromptFormDynamicArgs,
        ) => MaybePromise<
          Partial<Omit<T, 'inputs'> & { inputs: Array<AddDynamic<FormInput>> }> | null | undefined
        >;
      }
    : T & AddDynamicMethod<T>
  : never;

export type DynamicPromptFormArg = AddDynamic<FormInput>;
