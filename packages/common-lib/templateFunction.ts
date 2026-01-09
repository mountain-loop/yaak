import type {
  CallTemplateFunctionArgs,
  JsonPrimitive,
  TemplateFunctionArg,
} from '@yaakapp-internal/plugins';

export function validateTemplateFunctionArgs(
  fnName: string,
  args: TemplateFunctionArg[],
  values: CallTemplateFunctionArgs['values'],
): string | null {
  for (const arg of args) {
    if ('inputs' in arg && arg.inputs) {
      // Recurse down
      const err = validateTemplateFunctionArgs(fnName, arg.inputs, values);
      if (err) return err;
    }
    if (!('name' in arg)) continue;
    if (arg.optional) continue;
    if (arg.defaultValue != null) continue;
    if (arg.hidden) continue;
    if (values[arg.name] != null) continue;

    return `Missing required argument "${arg.label || arg.name}" for template function ${fnName}()`;
  }

  return null;
}

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
    if (input.type === 'checkbox' && values[input.name] === undefined) {
      newValues[input.name] = false;
    }
    // Recurse down to all child inputs
    if ('inputs' in input) {
      newValues = applyFormInputDefaults(input.inputs ?? [], newValues);
    }
  }
  return newValues;
}
