import type { ActionInvocation, GlobalAction } from "@yaakapp-internal/proxy-lib";
import type { HotkeyContextValue, HotKeyOptions } from "@yaakapp-internal/ui";
import { useEffect, useMemo } from "react";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { rpc } from "./rpc";
import { getOsType } from "./tauri";

declare module "@yaakapp-internal/ui" {
  interface HotkeyActionRegistry {
    action: GlobalAction;
  }
}

type Keys = { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };

type Binding = { invocation: ActionInvocation; hotkey: string; keys: Keys };

interface Callback {
  action: GlobalAction;
  callback: (e: KeyboardEvent) => void;
  options: HotKeyOptions;
}

let callbacks: Callback[] = [];

function register(
  action: GlobalAction,
  callback: (e: KeyboardEvent) => void,
  options: HotKeyOptions,
) {
  callbacks = [
    ...callbacks.filter((cb) => cb.action !== action || cb.options.priority !== options.priority),
    { action, callback, options },
  ].sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0));
  return () => {
    callbacks = callbacks.filter((cb) => cb.callback !== callback);
  };
}

/** Parse a hotkey string like "Ctrl+Shift+P" into its parts. */
function parseHotkey(hotkey: string): Keys {
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

function matchesEvent(keys: Keys, e: KeyboardEvent): boolean {
  return (
    e.ctrlKey === keys.ctrl &&
    e.shiftKey === keys.shift &&
    e.altKey === keys.alt &&
    e.metaKey === keys.meta &&
    e.key.toLowerCase() === keys.key
  );
}

/**
 * Hotkeys from the actions' metadata: a key runs the component bound to its action if one is,
 * and the action itself otherwise.
 */
export function useHotkeyContextValue(): HotkeyContextValue {
  const { data } = useRpcQuery("list_actions", {});

  const bindings = useMemo(() => {
    const map = new Map<GlobalAction, Binding>();
    for (const [invocation, meta] of data?.actions ?? []) {
      if (meta.defaultHotkey == null) continue;
      const hotkey = meta.defaultHotkey.replace(/\bCtrl\b/, "Control");
      map.set(invocation.action, { invocation, hotkey, keys: parseHotkey(hotkey) });
    }
    return map;
  }, [data]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      for (const { action, callback, options } of callbacks) {
        const enable = typeof options.enable === "function" ? options.enable() : options.enable;
        const binding = bindings.get(action);
        if (enable === false || binding == null || !matchesEvent(binding.keys, e)) continue;
        if (!options.allowDefault) e.preventDefault();
        callback(e);
        return;
      }
      for (const binding of bindings.values()) {
        if (!matchesEvent(binding.keys, e)) continue;
        e.preventDefault();
        void rpc("execute_action", binding.invocation);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings]);

  return useMemo(
    () => ({
      os: getOsType(),
      bindingFor: (action) => {
        const hotkey = bindings.get(action)?.hotkey;
        return hotkey == null ? null : [hotkey];
      },
      register,
    }),
    [bindings],
  );
}
