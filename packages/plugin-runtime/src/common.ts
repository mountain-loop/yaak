import {
  CallHttpAuthenticationActionArgs,
  CallTemplateFunctionArgs,
  JsonPrimitive,
  TemplateFunctionArg,
} from '@yaakapp-internal/plugins';
import { Context, DynamicAuthenticationArg, DynamicTemplateFunctionArg } from '@yaakapp/api';

/** Recursively apply form input defaults to a set of values */
export function applyFormInputDefaults(
  inputs: TemplateFunctionArg[],
  values: { [p: string]: JsonPrimitive | undefined },
) {
  let newValues: { [p: string]: JsonPrimitive | undefined } = { ...values };
  for (const input of inputs) {
    if ('defaultValue' in input && values[input.name] === undefined) {
      newValues[input.name] = input.defaultValue;
    }
    // Recurse down to all child inputs
    if ('inputs' in input) {
      newValues = applyFormInputDefaults(input.inputs ?? [], newValues);
    }
  }
  return newValues;
}

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
      newArg.inputs = await applyDynamicFormInput(ctx, newArg.inputs, callArgs as any);
    }
    resolvedArgs.push(newArg);
  }
  return resolvedArgs;
}
