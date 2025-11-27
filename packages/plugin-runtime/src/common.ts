import { CallHttpAuthenticationActionArgs, CallTemplateFunctionArgs } from '@yaakapp-internal/plugins';
import { Context, DynamicAuthenticationArg, DynamicTemplateFunctionArg } from '@yaakapp/api';

export async function applyDynamicFormInput(
  ctx: Context,
  args: DynamicTemplateFunctionArg[],
  callArgs: CallTemplateFunctionArgs,
): Promise<DynamicTemplateFunctionArg[]>;

export async function applyDynamicFormInput(
  ctx: Context,
  args: DynamicAuthenticationArg[],
  callArgs: CallHttpAuthenticationActionArgs,
): Promise<DynamicAuthenticationArg[]>;

export async function applyDynamicFormInput(
  ctx: Context,
  args: (DynamicTemplateFunctionArg | DynamicAuthenticationArg)[],
  callArgs: CallTemplateFunctionArgs | CallHttpAuthenticationActionArgs,
): Promise<(DynamicTemplateFunctionArg | DynamicAuthenticationArg)[]> {
  const resolvedArgs: any[] = [];
  for (const { dynamic, ...arg } of args) {
    const newArg: any = {
      ...arg,
      ...(typeof dynamic === 'function' ? await dynamic(ctx, callArgs as any) : undefined),
    };
    if ('inputs' in newArg && Array.isArray(newArg.inputs)) {
      try {
        newArg.inputs = await applyDynamicFormInput(ctx, newArg.inputs, callArgs as any);
      } catch (e) {
        console.error('Failed to apply dynamic form input', e);
      }
    }
    resolvedArgs.push(newArg);
  }
  return resolvedArgs;
}
