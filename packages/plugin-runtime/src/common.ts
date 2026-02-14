import type {
  CallPromptFormDynamicArgs,
  Context,
  DynamicAuthenticationArg,
  DynamicPromptFormArg,
  DynamicTemplateFunctionArg,
} from '@yaakapp/api';
import type {
  CallHttpAuthenticationActionArgs,
  CallTemplateFunctionArgs,
} from '@yaakapp-internal/plugins';

type AnyDynamicArg = DynamicTemplateFunctionArg | DynamicAuthenticationArg | DynamicPromptFormArg;
type AnyCallArgs =
  | CallTemplateFunctionArgs
  | CallHttpAuthenticationActionArgs
  | CallPromptFormDynamicArgs;

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
  args: DynamicPromptFormArg[],
  callArgs: CallPromptFormDynamicArgs,
): Promise<DynamicPromptFormArg[]>;

export async function applyDynamicFormInput(
  ctx: Context,
  args: AnyDynamicArg[],
  callArgs: AnyCallArgs,
): Promise<AnyDynamicArg[]> {
  const resolvedArgs: AnyDynamicArg[] = [];
  for (const { dynamic, ...arg } of args) {
    const dynamicResult =
      typeof dynamic === 'function'
        ? await dynamic(
            ctx,
            callArgs as CallTemplateFunctionArgs &
              CallHttpAuthenticationActionArgs &
              CallPromptFormDynamicArgs,
          )
        : undefined;

    const newArg = {
      ...arg,
      ...dynamicResult,
    } as AnyDynamicArg;

    if ('inputs' in newArg && Array.isArray(newArg.inputs)) {
      try {
        newArg.inputs = await applyDynamicFormInput(
          ctx,
          newArg.inputs as DynamicTemplateFunctionArg[],
          callArgs as CallTemplateFunctionArgs &
            CallHttpAuthenticationActionArgs &
            CallPromptFormDynamicArgs,
        );
      } catch (e) {
        console.error('Failed to apply dynamic form input', e);
      }
    }
    resolvedArgs.push(newArg);
  }
  return resolvedArgs;
}
