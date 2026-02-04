import type { Context, DynamicAuthenticationArg, DynamicTemplateFunctionArg } from '@yaakapp/api';
import type {
  CallHttpAuthenticationActionArgs,
  CallTemplateFunctionArgs,
} from '@yaakapp-internal/plugins';

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
  const resolvedArgs: (DynamicTemplateFunctionArg | DynamicAuthenticationArg)[] = [];
  for (const { dynamic, ...arg } of args) {
    const dynamicResult =
      typeof dynamic === 'function'
        ? await dynamic(
            ctx,
            callArgs as CallTemplateFunctionArgs & CallHttpAuthenticationActionArgs,
          )
        : undefined;

    const newArg = {
      ...arg,
      ...dynamicResult,
    } as DynamicTemplateFunctionArg | DynamicAuthenticationArg;

    if ('inputs' in newArg && Array.isArray(newArg.inputs)) {
      try {
        newArg.inputs = await applyDynamicFormInput(
          ctx,
          newArg.inputs as DynamicTemplateFunctionArg[],
          callArgs as CallTemplateFunctionArgs & CallHttpAuthenticationActionArgs,
        );
      } catch (e) {
        console.error('Failed to apply dynamic form input', e);
      }
    }
    resolvedArgs.push(newArg);
  }
  return resolvedArgs;
}
