import type { FormInput, TemplateFunction } from '@yaakapp-internal/plugins';
import type { Tokens } from '@yaakapp-internal/templates';

/**
 * Process the initial tokens from the template and merge those with the default values pulled from
 * the template function definition.
 */
export function collectArgumentValues(initialTokens: Tokens, templateFunction: TemplateFunction) {
  const initial: Record<string, string | boolean> = {};
  const initialArgs =
    initialTokens.tokens[0]?.type === 'tag' && initialTokens.tokens[0]?.val.type === 'fn'
      ? initialTokens.tokens[0]?.val.args
      : [];

  const processArg = (arg: FormInput) => {
    if ('inputs' in arg && arg.inputs) {
      arg.inputs.forEach(processArg);
    }
    if (!('name' in arg)) return;

    const initialArg = initialArgs.find((a) => a.name === arg.name);
    const initialArgValue =
      initialArg?.value.type === 'str'
        ? initialArg?.value.text
        : initialArg?.value.type === 'bool'
          ? initialArg.value.value
          : undefined;
    const value = initialArgValue ?? arg.defaultValue;
    if (value != null) {
      initial[arg.name] = value;
    }
  };

  templateFunction.args.forEach(processArg);

  return initial;
}
