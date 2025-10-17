import {
  CallTemplateFunctionArgs,
  FormInput,
  GetHttpAuthenticationConfigRequest,
  TemplateFunction,
  TemplateFunctionArg,
} from '../bindings/gen_events';
import { MaybePromise } from '../helpers';
import { Context } from './Context';

export type DynamicTemplateFunctionArg = FormInput & {
  dynamic(
    ctx: Context,
    args: GetHttpAuthenticationConfigRequest,
  ): MaybePromise<Partial<FormInput> | undefined | null>;
};

export type TemplateFunctionPlugin = TemplateFunction & {
  args: (TemplateFunctionArg | DynamicTemplateFunctionArg)[];
  onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null>;
};
