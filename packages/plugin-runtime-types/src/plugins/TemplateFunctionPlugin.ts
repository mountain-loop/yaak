import { CallTemplateFunctionArgs, FormInput, TemplateFunction } from '../bindings/gen_events';
import { MaybePromise } from '../helpers';
import { Context } from './Context';

type AddDynamicMethod<T> = {
  dynamic?: (
    ctx: Context,
    args: CallTemplateFunctionArgs,
  ) => MaybePromise<Partial<T> | null | undefined>;
};

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
