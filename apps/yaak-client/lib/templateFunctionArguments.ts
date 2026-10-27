import type { TemplateFunction } from "@yaakapp-internal/plugins";
import type { FnArg, Tokens } from "@yaakapp-internal/templates";
import { collectArgumentValues } from "../components/core/Editor/twig/util";

type ArgumentValues = Record<string, string | boolean>;

function functionArgs(tokens: Tokens): FnArg[] {
  const first = tokens.tokens[0];
  return first?.type === "tag" && first.val.type === "fn" ? first.val.args : [];
}

/** Adapt expressions to the template text that the form's editors understand. */
export async function collectEditableArgumentValues(
  tokens: Tokens,
  templateFunction: TemplateFunction,
  tokensToString: (tokens: Tokens) => Promise<string>,
): Promise<ArgumentValues> {
  const first = tokens.tokens[0];
  if (first?.type !== "tag" || first.val.type !== "fn") {
    return collectArgumentValues(tokens, templateFunction);
  }

  const args = await Promise.all(
    first.val.args.map(async (arg): Promise<FnArg> => {
      if (arg.value.type !== "fn" && arg.value.type !== "var") return arg;
      const text = await tokensToString({ tokens: [{ type: "tag", val: arg.value }] });
      return { ...arg, value: { type: "str", text } };
    }),
  );

  return collectArgumentValues(
    { tokens: [{ ...first, val: { ...first.val, args } }] },
    templateFunction,
  );
}

/**
 * Displaying an expression as template text must not change its stored type: a string
 * wrapper adds rendering depth. Only deliberately changed inputs use the form's new values.
 */
export function preserveUnchangedArgumentExpressions(
  args: FnArg[],
  initialTokens: Tokens,
  initialValues: ArgumentValues,
  values: ArgumentValues,
): FnArg[] {
  const initialArgs = functionArgs(initialTokens);
  return args.map((arg) => {
    const initial = initialArgs.find((a) => a.name === arg.name);
    if (
      (initial?.value.type === "fn" || initial?.value.type === "var") &&
      Object.hasOwn(initialValues, arg.name) &&
      values[arg.name] === initialValues[arg.name]
    ) {
      return initial;
    }
    return arg;
  });
}
