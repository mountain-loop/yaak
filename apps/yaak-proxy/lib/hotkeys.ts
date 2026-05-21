import type { ActionInvocation, ActionMetadata } from "@yaakapp-internal/proxy-lib";
import { rpc } from "./rpc";

type ActionBinding = {
  invocation: ActionInvocation;
  meta: ActionMetadata;
  keys: { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
};

/** Parse a hotkey string like "Ctrl+Shift+P" into its parts. */
function parseHotkey(hotkey: string): ActionBinding["keys"] {
  const parts = hotkey.split("+").map((p) => p.trim().toLowerCase());
  return {
    ctrl: parts.includes("ctrl") || parts.includes("control"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    meta: parts.includes("meta") || parts.includes("cmd") || parts.includes("command"),
    key:
      parts.filter(
        (p) => !["ctrl", "control", "shift", "alt", "meta", "cmd", "command"].includes(p),
      )[0] ?? "",
  };
}

function matchesEvent(binding: ActionBinding["keys"], e: KeyboardEvent): boolean {
  return (
    e.ctrlKey === binding.ctrl &&
    e.shiftKey === binding.shift &&
    e.altKey === binding.alt &&
    e.metaKey === binding.meta &&
    e.key.toLowerCase() === binding.key
  );
}

/** Fetch all actions from Rust and register a global keydown listener. */
export async function initHotkeys(): Promise<() => void> {
  const { actions } = await rpc("list_actions", {});

  const bindings: ActionBinding[] = actions
    .filter(
      // oxlint-disable-next-line no-redundant-type-constituents -- ActionMetadata resolves at runtime
      (entry): entry is [ActionInvocation, ActionMetadata & { defaultHotkey: string }] =>
        entry[1].defaultHotkey != null,
    )
    .map(([invocation, meta]) => ({
      invocation,
      meta,
      keys: parseHotkey(meta.defaultHotkey),
    }));

  function onKeyDown(e: KeyboardEvent) {
    for (const binding of bindings) {
      if (matchesEvent(binding.keys, e)) {
        e.preventDefault();
        void rpc("execute_action", binding.invocation);
        return;
      }
    }
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
