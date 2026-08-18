import type {
  CallPromptFormDynamicArgs,
  Context,
  DynamicAuthenticationArg,
  DynamicPromptFormArg,
  DynamicTemplateFunctionArg,
  TemplateFunctionPlugin,
} from "@yaakapp/api";
import type {
  CallHttpAuthenticationActionArgs,
  CallTemplateFunctionArgs,
  FormInput,
} from "@yaakapp-internal/plugins";

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
      typeof dynamic === "function"
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

    if ("inputs" in newArg && Array.isArray(newArg.inputs)) {
      try {
        newArg.inputs = await applyDynamicFormInput(
          ctx,
          newArg.inputs as DynamicTemplateFunctionArg[],
          callArgs as CallTemplateFunctionArgs &
            CallHttpAuthenticationActionArgs &
            CallPromptFormDynamicArgs,
        );
      } catch (e) {
        console.error("Failed to apply dynamic form input", e);
      }
    }
    resolvedArgs.push(newArg);
  }
  return resolvedArgs;
}

/** What a host receives has to be data all the way down. */
export function stripDynamicCallbacks(inputs: { dynamic?: unknown }[]): FormInput[] {
  return inputs.map((input) => {
    // oxlint-disable-next-line no-explicit-any -- stripping dynamic from union type
    const { dynamic: _dynamic, ...rest } = input as any;
    if ("inputs" in rest && Array.isArray(rest.inputs)) {
      rest.inputs = stripDynamicCallbacks(rest.inputs);
    }
    return rest as FormInput;
  });
}

/** Select options used to carry `name` where they now carry `label`. */
export function migrateTemplateFunctionSelectOptions(
  f: TemplateFunctionPlugin,
): TemplateFunctionPlugin {
  const migratedArgs = f.args.map((a) => {
    if (a.type === "select") {
      type LegacyOption = { label?: string; value: string; name?: string };
      a.options = a.options.map((o) => {
        const legacy = o as LegacyOption;
        return { label: legacy.label ?? legacy.name ?? "", value: legacy.value };
      });
    }
    return a;
  });

  return { ...f, args: migratedArgs };
}
