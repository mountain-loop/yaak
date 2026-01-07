import { type } from '@tauri-apps/plugin-os';
import { debounce } from '@yaakapp-internal/lib';
import { settingsAtom } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { capitalize } from '../lib/capitalize';
import { jotaiStore } from '../lib/jotai';

const HOLD_KEYS = ['Shift', 'Control', 'Command', 'Alt', 'Meta'];
const SINGLE_WHITELIST = ['Delete', 'Enter', 'Backspace'];

export type HotkeyAction =
  | 'app.zoom_in'
  | 'app.zoom_out'
  | 'app.zoom_reset'
  | 'command_palette.toggle'
  | 'editor.autocomplete'
  | 'environment_editor.toggle'
  | 'hotkeys.showHelp'
  | 'model.create'
  | 'model.duplicate'
  | 'request.send'
  | 'request.rename'
  | 'switcher.next'
  | 'switcher.prev'
  | 'switcher.toggle'
  | 'settings.show'
  | 'sidebar.filter'
  | 'sidebar.selected.delete'
  | 'sidebar.selected.duplicate'
  | 'sidebar.selected.rename'
  | 'sidebar.expand_all'
  | 'sidebar.collapse_all'
  | 'sidebar.focus'
  | 'sidebar.context_menu'
  | 'url_bar.focus'
  | 'workspace_settings.show';

/** Default hotkeys for macOS (uses Meta for Cmd) */
const defaultHotkeysMac: Record<HotkeyAction, string[]> = {
  'app.zoom_in': ['Meta+Equal'],
  'app.zoom_out': ['Meta+Minus'],
  'app.zoom_reset': ['Meta+0'],
  'command_palette.toggle': ['Meta+k'],
  'editor.autocomplete': ['Control+Space'],
  'environment_editor.toggle': ['Meta+Shift+e'],
  'request.rename': ['Control+Shift+r'],
  'request.send': ['Meta+Enter', 'Meta+r'],
  'hotkeys.showHelp': ['Meta+Shift+/'],
  'model.create': ['Meta+n'],
  'model.duplicate': ['Meta+d'],
  'switcher.next': ['Control+Shift+Tab'],
  'switcher.prev': ['Control+Tab'],
  'switcher.toggle': ['Meta+p'],
  'settings.show': ['Meta+,'],
  'sidebar.filter': ['Meta+f'],
  'sidebar.expand_all': ['Meta+Shift+Equal'],
  'sidebar.collapse_all': ['Meta+Shift+Minus'],
  'sidebar.selected.delete': ['Delete', 'Meta+Backspace'],
  'sidebar.selected.duplicate': ['Meta+d'],
  'sidebar.selected.rename': ['Enter'],
  'sidebar.focus': ['Meta+b'],
  'sidebar.context_menu': ['Control+Enter'],
  'url_bar.focus': ['Meta+l'],
  'workspace_settings.show': ['Meta+;'],
};

/** Default hotkeys for Windows/Linux (uses Control for Ctrl) */
const defaultHotkeysOther: Record<HotkeyAction, string[]> = {
  'app.zoom_in': ['Control+Equal'],
  'app.zoom_out': ['Control+Minus'],
  'app.zoom_reset': ['Control+0'],
  'command_palette.toggle': ['Control+k'],
  'editor.autocomplete': ['Control+Space'],
  'environment_editor.toggle': ['Control+Shift+e'],
  'request.rename': ['F2'],
  'request.send': ['Control+Enter', 'Control+r'],
  'hotkeys.showHelp': ['Control+Shift+/'],
  'model.create': ['Control+n'],
  'model.duplicate': ['Control+d'],
  'switcher.next': ['Control+Shift+Tab'],
  'switcher.prev': ['Control+Tab'],
  'switcher.toggle': ['Control+p'],
  'settings.show': ['Control+,'],
  'sidebar.filter': ['Control+f'],
  'sidebar.expand_all': ['Control+Shift+Equal'],
  'sidebar.collapse_all': ['Control+Shift+Minus'],
  'sidebar.selected.delete': ['Delete', 'Control+Backspace'],
  'sidebar.selected.duplicate': ['Control+d'],
  'sidebar.selected.rename': ['Enter'],
  'sidebar.focus': ['Control+b'],
  'sidebar.context_menu': ['Alt+Insert'],
  'url_bar.focus': ['Control+l'],
  'workspace_settings.show': ['Control+;'],
};

/** Get the default hotkeys for the current platform */
export const defaultHotkeys: Record<HotkeyAction, string[]> =
  type() === 'macos' ? defaultHotkeysMac : defaultHotkeysOther;

/** Atom that provides the effective hotkeys by merging defaults with user settings */
export const hotkeysAtom = atom((get) => {
  const settings = get(settingsAtom);
  const customHotkeys = settings?.hotkeys ?? {};

  // Merge default hotkeys with custom hotkeys from settings
  // Custom hotkeys override defaults for the same action
  // An empty array means the hotkey is intentionally disabled
  const merged: Record<HotkeyAction, string[]> = { ...defaultHotkeys };
  for (const [action, keys] of Object.entries(customHotkeys)) {
    if (action in defaultHotkeys && Array.isArray(keys)) {
      merged[action as HotkeyAction] = keys;
    }
  }
  return merged;
});

/** Helper function to get current hotkeys from the store */
function getHotkeys(): Record<HotkeyAction, string[]> {
  return jotaiStore.get(hotkeysAtom);
}

const hotkeyLabels: Record<HotkeyAction, string> = {
  'app.zoom_in': 'Zoom In',
  'app.zoom_out': 'Zoom Out',
  'app.zoom_reset': 'Zoom to Actual Size',
  'command_palette.toggle': 'Toggle Command Palette',
  'editor.autocomplete': 'Trigger Autocomplete',
  'environment_editor.toggle': 'Edit Environments',
  'hotkeys.showHelp': 'Show Keyboard Shortcuts',
  'model.create': 'New Request',
  'model.duplicate': 'Duplicate Request',
  'request.rename': 'Rename Active Request',
  'request.send': 'Send Active Request',
  'switcher.next': 'Go To Previous Request',
  'switcher.prev': 'Go To Next Request',
  'switcher.toggle': 'Toggle Request Switcher',
  'settings.show': 'Open Settings',
  'sidebar.filter': 'Filter Sidebar',
  'sidebar.expand_all': 'Expand All Folders',
  'sidebar.collapse_all': 'Collapse All Folders',
  'sidebar.selected.delete': 'Delete Selected Sidebar Item',
  'sidebar.selected.duplicate': 'Duplicate Selected Sidebar Item',
  'sidebar.selected.rename': 'Rename Selected Sidebar Item',
  'sidebar.focus': 'Focus or Toggle Sidebar',
  'sidebar.context_menu': 'Show Context Menu',
  'url_bar.focus': 'Focus URL',
  'workspace_settings.show': 'Open Workspace Settings',
};

const layoutInsensitiveKeys = [
  'Equal',
  'Minus',
  'BracketLeft',
  'BracketRight',
  'Backquote',
  'Space',
];

export const hotkeyActions: HotkeyAction[] = (
  Object.keys(defaultHotkeys) as (keyof typeof defaultHotkeys)[]
).sort((a, b) => {
  const scopeA = a.split('.')[0] || '';
  const scopeB = b.split('.')[0] || '';
  if (scopeA !== scopeB) {
    return scopeA.localeCompare(scopeB);
  }
  return hotkeyLabels[a].localeCompare(hotkeyLabels[b]);
});

export type HotKeyOptions = {
  enable?: boolean | (() => boolean);
  priority?: number;
  allowDefault?: boolean;
};

interface Callback {
  action: HotkeyAction;
  callback: (e: KeyboardEvent) => void;
  options: HotKeyOptions;
}

const callbacksAtom = atom<Callback[]>([]);
const currentKeysAtom = atom<Set<string>>(new Set([]));
export const sortedCallbacksAtom = atom((get) =>
  [...get(callbacksAtom)].sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0)),
);

const clearCurrentKeysDebounced = debounce(() => {
  jotaiStore.set(currentKeysAtom, new Set([]));
}, 5000);

export function useHotKey(
  action: HotkeyAction | null,
  callback: (e: KeyboardEvent) => void,
  options: HotKeyOptions = {},
) {
  useEffect(() => {
    if (action == null) return;
    jotaiStore.set(callbacksAtom, (prev) => {
      const without = prev.filter((cb) => {
        const isTheSame = cb.action === action && cb.options.priority === options.priority;
        return !isTheSame;
      });
      const newCb: Callback = { action, callback, options };
      return [...without, newCb];
    });
    return () => {
      jotaiStore.set(callbacksAtom, (prev) => prev.filter((cb) => cb.callback !== callback));
    };
  }, [action, callback, options]);
}

export function useSubscribeHotKeys() {
  useEffect(() => {
    document.addEventListener('keyup', handleKeyUp, { capture: true });
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('keyup', handleKeyUp, { capture: true });
    };
  }, []);
}

function handleKeyUp(e: KeyboardEvent) {
  const keyToRemove = layoutInsensitiveKeys.includes(e.code) ? e.code : e.key;
  const currentKeys = new Set(jotaiStore.get(currentKeysAtom));
  currentKeys.delete(keyToRemove);

  // Clear all keys if no longer holding modifier
  // HACK: This is to get around the case of DOWN SHIFT -> DOWN : -> UP SHIFT -> UP ;
  //  As you see, the ":" is not removed because it turned into ";" when shift was released
  const isHoldingModifier = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
  if (!isHoldingModifier) {
    currentKeys.clear();
  }

  jotaiStore.set(currentKeysAtom, currentKeys);
}

function handleKeyDown(e: KeyboardEvent) {
  // Don't add key if not holding modifier
  const isValidKeymapKey =
    e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || SINGLE_WHITELIST.includes(e.key);
  if (!isValidKeymapKey) {
    return;
  }

  // Don't add hold keys
  if (HOLD_KEYS.includes(e.key)) {
    return;
  }

  const keyToAdd = layoutInsensitiveKeys.includes(e.code) ? e.code : e.key;
  const currentKeys = new Set(jotaiStore.get(currentKeysAtom));
  currentKeys.add(keyToAdd);

  const currentKeysWithModifiers = new Set(currentKeys);
  if (e.altKey) currentKeysWithModifiers.add('Alt');
  if (e.ctrlKey) currentKeysWithModifiers.add('Control');
  if (e.metaKey) currentKeysWithModifiers.add('Meta');
  if (e.shiftKey) currentKeysWithModifiers.add('Shift');

  // Don't trigger if the user is focused within an element that explicitly disableds hotkeys
  if (document.activeElement?.closest('[data-disable-hotkey]')) {
    return;
  }

  // Don't support certain single-key combinations within inputs
  if (
    (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) &&
    currentKeysWithModifiers.size === 1 &&
    (currentKeysWithModifiers.has('Backspace') || currentKeysWithModifiers.has('Delete'))
  ) {
    return;
  }

  const executed: string[] = [];
  for (const { action, callback, options } of jotaiStore.get(sortedCallbacksAtom)) {
    const enable = typeof options.enable === 'function' ? options.enable() : options.enable;
    if (enable === false) {
      continue;
    }

    if (keysMatchAction(Array.from(currentKeysWithModifiers), action)) {
      if (!options.allowDefault) {
        e.preventDefault();
        e.stopPropagation();
      }
      callback(e);
      executed.push(`${action} ${options.priority ?? 0}`);
      break;
    }
  }

  if (executed.length > 0) {
    console.log('Executed hotkey', executed.join(', '));
    jotaiStore.set(currentKeysAtom, new Set([]));
  }
  clearCurrentKeysDebounced();
}

export function useHotkeyLabel(action: HotkeyAction): string {
  return hotkeyLabels[action];
}

export function getHotkeyScope(action: HotkeyAction): string {
  const scope = action.split('.')[0];
  return scope || '';
}

export function formatHotkeyString(trigger: string): string[] {
  const os = type();
  const parts = trigger.split('+');
  const labelParts: string[] = [];

  for (const p of parts) {
    if (os === 'macos') {
      if (p === 'Meta') {
        labelParts.push('⌘');
      } else if (p === 'Shift') {
        labelParts.push('⇧');
      } else if (p === 'Control') {
        labelParts.push('⌃');
      } else if (p === 'Alt') {
        labelParts.push('⌥');
      } else if (p === 'Enter') {
        labelParts.push('↩');
      } else if (p === 'Tab') {
        labelParts.push('⇥');
      } else if (p === 'Backspace') {
        labelParts.push('⌫');
      } else if (p === 'Delete') {
        labelParts.push('⌦');
      } else if (p === 'Minus') {
        labelParts.push('-');
      } else if (p === 'Plus') {
        labelParts.push('+');
      } else if (p === 'Equal') {
        labelParts.push('=');
      } else if (p === 'Space') {
        labelParts.push('Space');
      } else {
        labelParts.push(capitalize(p));
      }
    } else {
      if (p === 'Control') {
        labelParts.push('Ctrl');
      } else if (p === 'Space') {
        labelParts.push('Space');
      } else {
        labelParts.push(capitalize(p));
      }
    }
  }

  if (os === 'macos') {
    return labelParts;
  }
  return [labelParts.join('+')];
}

export function useFormattedHotkey(action: HotkeyAction | null): string[] | null {
  const hotkeys = useAtomValue(hotkeysAtom);
  const trigger = action != null ? (hotkeys[action]?.[0] ?? null) : null;
  if (trigger == null) {
    return null;
  }

  return formatHotkeyString(trigger);
}

function compareKeys(keysA: string[], keysB: string[]) {
  if (keysA.length !== keysB.length) return false;
  const sortedA = keysA
    .map((k) => k.toLowerCase())
    .sort()
    .join('::');
  const sortedB = keysB
    .map((k) => k.toLowerCase())
    .sort()
    .join('::');
  return sortedA === sortedB;
}

/** Build the full key combination from a KeyboardEvent including modifiers */
function getKeysFromEvent(e: KeyboardEvent): string[] {
  const keys: string[] = [];
  if (e.altKey) keys.push('Alt');
  if (e.ctrlKey) keys.push('Control');
  if (e.metaKey) keys.push('Meta');
  if (e.shiftKey) keys.push('Shift');

  // Add the actual key (use code for layout-insensitive keys)
  const keyToAdd = layoutInsensitiveKeys.includes(e.code) ? e.code : e.key;
  keys.push(keyToAdd);

  return keys;
}

/** Check if a set of pressed keys matches any hotkey for the given action */
function keysMatchAction(keys: string[], action: HotkeyAction): boolean {
  const hotkeys = getHotkeys();
  const hkKeys = hotkeys[action];
  if (!hkKeys || hkKeys.length === 0) return false;

  for (const hkKey of hkKeys) {
    const hotkeyParts = hkKey.split('+');
    if (compareKeys(hotkeyParts, keys)) {
      return true;
    }
  }
  return false;
}

/** Check if a KeyboardEvent matches a hotkey action */
export function eventMatchesHotkey(e: KeyboardEvent, action: HotkeyAction): boolean {
  const keys = getKeysFromEvent(e);
  return keysMatchAction(keys, action);
}
