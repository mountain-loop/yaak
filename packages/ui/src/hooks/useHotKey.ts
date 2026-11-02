import { createContext, useContext, useEffect } from "react";

/**
 * Hosts narrow {@link HotkeyAction} to their own actions by augmenting this with
 * `{ action: TheirActionUnion }`. Left empty, any string is an action.
 */
export interface HotkeyActionRegistry {}

export type HotkeyAction = HotkeyActionRegistry extends { action: infer A extends string }
  ? A
  : string;

export type HotKeyOptions = {
  enable?: boolean | (() => boolean);
  priority?: number;
  allowDefault?: boolean;
};

export interface HotkeyContextValue {
  /** The host's OS, which decides how key combos are labelled */
  os: string;
  /** The key combos bound to an action, like `["Meta+Shift+s"]`, or null when it has none */
  bindingFor: (action: HotkeyAction) => string[] | null;
  /** Bind a callback to an action's keys, returning the unbind */
  register: (
    action: HotkeyAction,
    callback: (e: KeyboardEvent) => void,
    options: HotKeyOptions,
  ) => () => void;
}

const HotkeyContext = createContext<HotkeyContextValue>({
  os: "",
  bindingFor: () => null,
  register: () => () => {},
});

export const HotkeyProvider = HotkeyContext;

export function useHotKey(
  action: HotkeyAction | null,
  callback: (e: KeyboardEvent) => void,
  options: HotKeyOptions = {},
) {
  const { register } = useContext(HotkeyContext);
  useEffect(() => {
    if (action == null) return;
    return register(action, callback, options);
  }, [action, callback, options, register]);
}

export function useFormattedHotkey(action: HotkeyAction | null): string[] | null {
  const { os, bindingFor } = useContext(HotkeyContext);
  const trigger = action == null ? null : (bindingFor(action)?.[0] ?? null);
  return trigger == null ? null : formatHotkey(trigger, os);
}

const MAC_KEY_LABELS: Record<string, string> = {
  Meta: "⌘",
  Shift: "⇧",
  Control: "⌃",
  Alt: "⌥",
  // U+21A9 has an emoji presentation, which Chromium's font fallback picks
  // (a blue glyph among monochrome ones). U+FE0E forces the text form.
  Enter: "↩︎",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  Minus: "-",
  Plus: "+",
  Equal: "=",
};

const OTHER_KEY_LABELS: Record<string, string> = {
  Control: "Ctrl",
};

/** Label a key combo like `Meta+Shift+s`: one glyph per key on macOS, one joined string elsewhere */
export function formatHotkey(trigger: string, os: string): string[] {
  const labels = os === "macos" ? MAC_KEY_LABELS : OTHER_KEY_LABELS;
  const parts = trigger.split("+").map((p) => labels[p] ?? capitalize(p));
  return os === "macos" ? parts : [parts.join("+")];
}

function capitalize(str: string): string {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
