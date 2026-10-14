import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { startCompletion } from "@codemirror/autocomplete";
import type { RpcSchema } from "@yaakapp-internal/rpc-schema";

export type JsonPathChildren = RpcSchema["cmd_http_response_json_children"][1];
export type LoadJsonPathChildren = (parent: string) => Promise<JsonPathChildren | null>;

export function normalizeJsonPath(value: string): string {
  const text = value.trim();
  if (!text) return "$";
  return text.startsWith("$") ? text : text.startsWith("[") ? `$${text}` : `$.${text}`;
}

/** Locate the unfinished child accessor, leaving complete JSONPath expressions to Rust. */
export function jsonPathCompletionTarget(
  text: string,
): { parent: string; fragment: string } | null {
  text = text.trim();
  if (text.length > 1024) return null;
  if (!text || text === "$") return { parent: "$", fragment: "" };
  let quote = "";
  let escaped = false;
  let depth = 0;
  let boundary = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = "";
      continue;
    }
    if (depth > 0 && (c === '"' || c === "'")) quote = c;
    else if (c === "[") {
      if (depth === 0) boundary = i;
      depth++;
    } else if (c === "]") {
      if (--depth < 0) return null;
    } else if (depth === 0 && c === ".") boundary = i;
  }
  if (depth === 0 && text.endsWith("]")) return { parent: normalizeJsonPath(text), fragment: "" };
  if (boundary === -1) return text.startsWith("$") ? null : { parent: "$", fragment: text };
  const fragment = text.slice(boundary);
  // Don't try to complete inside filters, unions, or recursive descent.
  if (
    depth > 1 ||
    fragment.startsWith("[?") ||
    fragment.startsWith("[(") ||
    text[boundary - 1] === "." ||
    fragment.startsWith("[...") ||
    (fragment.includes(",") && !fragment.startsWith('["') && !fragment.startsWith("['"))
  )
    return null;
  return { parent: normalizeJsonPath(text.slice(0, boundary)), fragment };
}

function matches(child: JsonPathChildren["children"][number], fragment: string): boolean {
  if (!fragment) return true;
  if (!fragment.startsWith("[")) return child.label.startsWith(fragment.replace(/^\./, ""));
  if (child.selector.startsWith("[") && !child.selector.startsWith('["'))
    return child.selector.startsWith(fragment);
  const quoted = JSON.stringify(child.label);
  const accessor = fragment.startsWith("['")
    ? `['${quoted.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}']`
    : `[${quoted}]`;
  return accessor.startsWith(fragment);
}

/** Complete a path progressively. Discovery is cached by response + parent in the caller. */
export function jsonPathCompletion(load: LoadJsonPathChildren) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    // Never replace later path segments while the user edits the middle of an expression.
    if (context.pos !== context.state.doc.length) return null;
    context.addEventListener("abort", () => {}, { onDocChange: true });
    const text = context.state.doc.toString();
    let target = jsonPathCompletionTarget(text);
    if (!target) return null;
    let children: JsonPathChildren | null = null;
    if (context.explicit && text.trim()) {
      // Accepting a container or explicitly opening completion explores its children, without
      // inserting an unfinished dot/bracket (the container itself may be the assertion target).
      const parent = normalizeJsonPath(text);
      children = await load(parent);
      if (context.aborted) return null;
      if (children?.children.length) target = { parent, fragment: "" };
      else children = null;
    }
    children ??= await load(target.parent);
    if (context.aborted || !children) return null;
    const parent = target.parent;
    const options = children.children
      .filter((child) => matches(child, target.fragment))
      .filter((child) => `${parent}${child.selector}` !== normalizeJsonPath(text))
      .map((child) => {
        const path = `${parent}${child.selector}`;
        return {
          label: child.label,
          displayLabel: child.selector.startsWith('["') ? child.selector : child.label,
          detail: child.kind,
          type: child.selector.startsWith("[") ? "variable" : "property",
          apply(
            view: Parameters<typeof startCompletion>[0],
            _completion: unknown,
            from: number,
            to: number,
          ) {
            view.dispatch({
              changes: { from, to, insert: path },
              selection: { anchor: from + path.length },
              userEvent: "input.complete",
            });
            if (["object", "array", "all items", "mixed"].includes(child.kind))
              startCompletion(view);
          },
        };
      });
    return options.length ? { from: 0, to: context.pos, options, filter: false } : null;
  };
}
