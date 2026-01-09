import type { CallTemplateFunctionArgs, FormInput, TemplateFunction } from '../bindings/gen_events';
import type { MaybePromise } from '../helpers';
import type { Context } from './Context';

type AddDynamicMethod<T> = {
  dynamic?: (
    ctx: Context,
    args: CallTemplateFunctionArgs,
  ) => MaybePromise<Partial<T> | null | undefined>;
};

// biome-ignore lint/suspicious/noExplicitAny: distributive conditional type pattern
type AddDynamic<T> = T extends any
  ? T extends { inputs?: FormInput[] }
    ? Omit<T, 'inputs'> & {
        inputs: Array<AddDynamic<FormInput>>;
        dynamic?: (
          ctx: Context,
          args: CallTemplateFunctionArgs,
        ) => MaybePromise<
          Partial<Omit<T, 'inputs'> & { inputs: Array<AddDynamic<FormInput>> }> | null | undefined
        >;
      }
    : T & AddDynamicMethod<T>
  : never;

export type DynamicTemplateFunctionArg = AddDynamic<FormInput>;

export type TemplateFunctionPlugin = Omit<TemplateFunction, 'args'> & {
  args: DynamicTemplateFunctionArg[];
  onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null>;
};
