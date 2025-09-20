import { type } from '@tauri-apps/plugin-os';
import { debounce } from '@yaakapp-internal/lib';
import { useEffect, useRef } from 'react';
import { capitalize } from '../lib/capitalize';

const HOLD_KEYS = ['Shift', 'Control', 'Command', 'Alt', 'Meta'];

export type HotkeyAction =
  | 'app.zoom_in'
  | 'app.zoom_out'
  | 'app.zoom_reset'
  | 'command_palette.toggle'
  | 'environmentEditor.toggle'
  | 'grpc_request.send'
  | 'hotkeys.showHelp'
  | 'http_request.create'
  | 'http_request.duplicate'
  | 'http_request.send'
  | 'request_switcher.next'
  | 'request_switcher.prev'
  | 'request_switcher.toggle'
  | 'settings.show'
  | 'sidebar.delete_selected_item'
  | 'sidebar.focus'
  | 'url_bar.focus'
  | 'workspace_settings.show';

const hotkeys: Record<HotkeyAction, string[]> = {
  'app.zoom_in': ['CmdCtrl+Equal'],
  'app.zoom_out': ['CmdCtrl+Minus'],
  'app.zoom_reset': ['CmdCtrl+0'],
  'command_palette.toggle': ['CmdCtrl+k'],
  'environmentEditor.toggle': ['CmdCtrl+Shift+E', 'CmdCtrl+Shift+e'],
  'grpc_request.send': ['CmdCtrl+Enter', 'CmdCtrl+r'],
  'hotkeys.showHelp': ['CmdCtrl+Shift+/', 'CmdCtrl+Shift+?'], // when shift is pressed, it might be a question mark
  'http_request.create': ['CmdCtrl+n'],
  'http_request.duplicate': ['CmdCtrl+d'],
  'http_request.send': ['CmdCtrl+Enter', 'CmdCtrl+r'],
  'request_switcher.next': ['Control+Shift+Tab'],
  'request_switcher.prev': ['Control+Tab'],
  'request_switcher.toggle': ['CmdCtrl+p'],
  'settings.show': ['CmdCtrl+,'],
  'sidebar.delete_selected_item': ['Delete'],
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
  'grpc_request.send': 'Send Message',
  'hotkeys.showHelp': 'Show Keyboard Shortcuts',
  'http_request.create': 'New Request',
  'http_request.duplicate': 'Duplicate Request',
  'http_request.send': 'Send Request',
  'request_switcher.next': 'Go To Previous Request',
  'request_switcher.prev': 'Go To Next Request',
  'request_switcher.toggle': 'Toggle Request Switcher',
  'settings.show': 'Open Settings',
  'sidebar.delete_selected_item': 'Delete Request',
  'sidebar.focus': 'Focus or Toggle Sidebar',
  'url_bar.focus': 'Focus URL',
  'workspace_settings.show': 'Open Workspace Settings',
};

const layoutInsensitiveKeys = ['Equal', 'Minus', 'BracketLeft', 'BracketRight', 'Backquote'];

export const hotkeyActions: HotkeyAction[] = Object.keys(hotkeys) as (keyof typeof hotkeys)[];

interface Options {
  enable?: boolean;
}

export function useHotKey(
  action: HotkeyAction | null,
  callback: (e: KeyboardEvent) => void,
  options: Options = {},
) {
  const currentKeys = useRef<Set<string>>(new Set());
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    // Sometimes the keyup event doesn't fire (eg, cmd+Tab), so we clear the keys after a timeout
    const clearCurrentKeys = debounce(() => currentKeys.current.clear(), 5000);

    const down = (e: KeyboardEvent) => {
      if (options.enable === false) {
        return;
      }

      // Don't add key if not holding modifier
      const isValidKeymapKey =
        e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key === 'Backspace' || e.key === 'Delete';
      if (!isValidKeymapKey) {
        return;
      }

      // Don't add hold keys
      if (HOLD_KEYS.includes(e.key)) {
        return;
      }

      const keyToAdd = layoutInsensitiveKeys.includes(e.code) ? e.code : e.key;
      currentKeys.current.add(keyToAdd);

      const currentKeysWithModifiers = new Set(currentKeys.current);
      if (e.altKey) currentKeysWithModifiers.add('Alt');
      if (e.ctrlKey) currentKeysWithModifiers.add('Control');
      if (e.metaKey) currentKeysWithModifiers.add('Meta');
      if (e.shiftKey) currentKeysWithModifiers.add('Shift');

      for (const [hkAction, hkKeys] of Object.entries(hotkeys) as [HotkeyAction, string[]][]) {
        if (
          (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) &&
          currentKeysWithModifiers.size === 1 &&
          currentKeysWithModifiers.has('Backspace')
        ) {
          // Don't support Backspace-only modifiers within input fields. This is fairly brittle, so maybe there's a
          // better way to do stuff like this in the future.
          continue;
        }

        for (const hkKey of hkKeys) {
          if (hkAction !== action) {
            continue;
          }

          const keys = hkKey.split('+').map(resolveHotkeyKey);
          if (
            keys.length === currentKeysWithModifiers.size &&
            keys.every((key) => currentKeysWithModifiers.has(key))
          ) {
            e.preventDefault();
            e.stopPropagation();
            callbackRef.current(e);
            currentKeys.current.clear();
          }
        }
      }

      clearCurrentKeys();
    };

    const up = (e: KeyboardEvent) => {
      if (options.enable === false) {
        return;
      }

      const keyToRemove = layoutInsensitiveKeys.includes(e.code) ? e.code : e.key;
      currentKeys.current.delete(keyToRemove);

      // Clear all keys if no longer holding modifier
      // HACK: This is to get around the case of DOWN SHIFT -> DOWN : -> UP SHIFT -> UP ;
      //  As you see, the ":" is not removed because it turned into ";" when shift was released
      const isHoldingModifier = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
      if (!isHoldingModifier) {
        currentKeys.current.clear();
      }
    };

    document.addEventListener('keyup', up, { capture: true });
    document.addEventListener('keydown', down, { capture: true });
    return () => {
      document.removeEventListener('keydown', down, { capture: true });
      document.removeEventListener('keyup', up, { capture: true });
    };
  }, [action, options.enable]);
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
