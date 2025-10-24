import { type } from '@tauri-apps/plugin-os';
import { debounce } from '@yaakapp-internal/lib';
import { atom } from 'jotai';
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
  | 'environmentEditor.toggle'
  | 'hotkeys.showHelp'
  | 'model.create'
  | 'model.duplicate'
  | 'request.send'
  | 'request.rename'
  | 'switcher.next'
  | 'switcher.prev'
  | 'switcher.toggle'
  | 'settings.show'
  | 'sidebar.selected.delete'
  | 'sidebar.selected.duplicate'
  | 'sidebar.selected.rename'
  | 'sidebar.focus'
  | 'url_bar.focus'
  | 'workspace_settings.show';

const hotkeys: Record<HotkeyAction, string[]> = {
  'app.zoom_in': ['CmdCtrl+Equal'],
  'app.zoom_out': ['CmdCtrl+Minus'],
  'app.zoom_reset': ['CmdCtrl+0'],
  'command_palette.toggle': ['CmdCtrl+k'],
  'environmentEditor.toggle': ['CmdCtrl+Shift+E', 'CmdCtrl+Shift+e'],
  'request.rename': type() === 'macos' ? ['Control+Shift+r'] : ['F2'],
  'request.send': ['CmdCtrl+Enter', 'CmdCtrl+r'],
  'hotkeys.showHelp': ['CmdCtrl+Shift+/', 'CmdCtrl+Shift+?'], // when shift is pressed, it might be a question mark
  'model.create': ['CmdCtrl+n'],
  'model.duplicate': ['CmdCtrl+d'],
  'switcher.next': ['Control+Shift+Tab'],
  'switcher.prev': ['Control+Tab'],
  'switcher.toggle': ['CmdCtrl+p'],
  'settings.show': ['CmdCtrl+,'],
  'sidebar.selected.delete': ['Delete', 'CmdCtrl+Backspace'],
  'sidebar.selected.duplicate': ['CmdCtrl+d'],
  'sidebar.selected.rename': ['Enter'],
  'sidebar.focus': ['CmdCtrl+b'],
  'url_bar.focus': ['CmdCtrl+l'],
  'workspace_settings.show': ['CmdCtrl+;'],
};

const hotkeyLabels: Record<HotkeyAction, string> = {
  'app.zoom_in': 'Zoom In',
  'app.zoom_out': 'Zoom Out',
  'app.zoom_reset': 'Zoom to Actual Size',
  'command_palette.toggle': 'Toggle Command Palette',
  'environmentEditor.toggle': 'Edit Environments',
  'hotkeys.showHelp': 'Show Keyboard Shortcuts',
  'model.create': 'New Request',
  'model.duplicate': 'Duplicate Request',
  'request.rename': 'Rename',
  'request.send': 'Send',
  'switcher.next': 'Go To Previous Request',
  'switcher.prev': 'Go To Next Request',
  'switcher.toggle': 'Toggle Request Switcher',
  'settings.show': 'Open Settings',
  'sidebar.selected.delete': 'Delete',
  'sidebar.selected.duplicate': 'Duplicate',
  'sidebar.selected.rename': 'Rename',
  'sidebar.focus': 'Focus or Toggle Sidebar',
  'url_bar.focus': 'Focus URL',
  'workspace_settings.show': 'Open Workspace Settings',
};

const layoutInsensitiveKeys = ['Equal', 'Minus', 'BracketLeft', 'BracketRight', 'Backquote'];

export const hotkeyActions: HotkeyAction[] = Object.keys(hotkeys) as (keyof typeof hotkeys)[];

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
      jotaiStore.set(callbacksAtom, (prev) => prev.filter((cb) => cb.action !== action));
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

  outer: for (const [hkAction, hkKeys] of Object.entries(hotkeys) as [HotkeyAction, string[]][]) {
    if (
      (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) &&
      currentKeysWithModifiers.size === 1 &&
      currentKeysWithModifiers.has('Backspace')
    ) {
      // Don't support Backspace-only modifiers within input fields. This is fairly brittle, so maybe there's a
      // better way to do stuff like this in the future.
      continue;
    }

    const executed: string[] = [];
    for (const { action, callback, options } of jotaiStore.get(sortedCallbacksAtom)) {
      if (hkAction !== action) {
        continue;
      }
      const enable = typeof options.enable === 'function' ? options.enable() : options.enable;
      if (enable === false) {
        continue;
      }

      for (const hkKey of hkKeys) {
        const keys = hkKey.split('+').map(resolveHotkeyKey);
        if (compareKeys(keys, Array.from(currentKeysWithModifiers))) {
          if (!options.allowDefault) {
            e.preventDefault();
            e.stopPropagation();
          }
          callback(e);
          executed.push(`${action} ${options.priority ?? 0}`);
          break outer;
        }
      }
    }
    if (executed.length > 0) {
      console.log('Executed hotkey', executed.join(', '));
      jotaiStore.set(currentKeysAtom, new Set([]));
    }
  }

  clearCurrentKeysDebounced();
}

export function useHotKeyLabel(action: HotkeyAction): string {
  return hotkeyLabels[action];
}

export function useFormattedHotkey(action: HotkeyAction | null): string[] | null {
  const trigger = action != null ? (hotkeys[action]?.[0] ?? null) : null;
  if (trigger == null) {
    return null;
  }

  const os = type();
  const parts = trigger.split('+');
  const labelParts: string[] = [];

  for (const p of parts) {
    if (os === 'macos') {
      if (p === 'CmdCtrl') {
        labelParts.push('⌘');
      } else if (p === 'Shift') {
        labelParts.push('⇧');
      } else if (p === 'Control') {
        labelParts.push('⌃');
      } else if (p === 'Enter') {
        labelParts.push('↩');
      } else if (p === 'Tab') {
        labelParts.push('⇥');
      } else if (p === 'Backspace') {
        labelParts.push('⌫');
      } else {
        labelParts.push(capitalize(p));
      }
    } else {
      if (p === 'CmdCtrl') {
        labelParts.push('Ctrl');
      } else {
        labelParts.push(capitalize(p));
      }
    }
  }

  if (os === 'macos') {
    return labelParts;
  } else {
    return [labelParts.join('+')];
  }
}

const resolveHotkeyKey = (key: string) => {
  const os = type();
  if (key === 'CmdCtrl' && os === 'macos') return 'Meta';
  else if (key === 'CmdCtrl') return 'Control';
  else return key;
};

function compareKeys(keysA: string[], keysB: string[]) {
  if (keysA.length !== keysB.length) return false;
  const sortedA = keysA.map((k) => k.toLowerCase()).sort().join('::');
  const sortedB = keysB.map((k) => k.toLowerCase()).sort().join('::');
  return sortedA === sortedB;
}
