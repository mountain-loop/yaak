import type { CallTemplateFunctionArgs, TemplateFunction } from '..';
import type { Context } from './Context';

export type TemplateFunctionPlugin = TemplateFunction & {
  onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null>;
};
