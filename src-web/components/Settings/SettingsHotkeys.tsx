import { type } from '@tauri-apps/plugin-os';
import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultHotkeys,
  type HotkeyAction,
  hotkeyActions,
  hotkeysAtom,
  useHotKeyLabel,
} from '../../hooks/useHotKey';
import { Button } from '../core/Button';
import { Heading } from '../core/Heading';
import { HStack, VStack } from '../core/Stacks';

const HOLD_KEYS = ['Shift', 'Control', 'Alt', 'Meta'];
const LAYOUT_INSENSITIVE_KEYS = ['Equal', 'Minus', 'BracketLeft', 'BracketRight', 'Backquote'];

/** Convert a KeyboardEvent to a hotkey string like "CmdCtrl+Shift+K" */
function eventToHotkeyString(e: KeyboardEvent): string | null {
  // Don't capture modifier-only key presses
  if (HOLD_KEYS.includes(e.key)) {
    return null;
  }

  const parts: string[] = [];
  const os = type();

  // Add modifiers in consistent order
  // Use CmdCtrl for Meta (macOS) or Control (Windows/Linux)
  if ((os === 'macos' && e.metaKey) || (os !== 'macos' && e.ctrlKey)) {
    parts.push('CmdCtrl');
  }
  // Add Control separately on macOS (for shortcuts like Control+Enter)
  if (os === 'macos' && e.ctrlKey) {
    parts.push('Control');
  }
  // Add Alt
  if (e.altKey) {
    parts.push('Alt');
  }
  // Add Shift
  if (e.shiftKey) {
    parts.push('Shift');
  }

  // Get the main key
  let key: string;
  if (LAYOUT_INSENSITIVE_KEYS.includes(e.code)) {
    // Use code for layout-insensitive keys (e.g., Equal, Minus)
    key = e.code;
  } else if (e.code.startsWith('Key')) {
    // For letter keys, use the letter from code (e.g., KeyK -> k)
    key = e.code.slice(3).toLowerCase();
  } else if (e.code.startsWith('Digit')) {
    // For number keys, use the number
    key = e.code.slice(5);
  } else {
    // For other keys, use the key value
    key = e.key;
  }

  parts.push(key);

  return parts.join('+');
}

export function SettingsHotkeys() {
  const settings = useAtomValue(settingsAtom);
  const hotkeys = useAtomValue(hotkeysAtom);

  if (settings == null) {
    return null;
  }

  return (
    <VStack space={3} className="mb-4">
      <div className="mb-3">
        <Heading>Keyboard Shortcuts</Heading>
        <p className="text-text-subtle">
          Click a shortcut and press keys to record a new binding. Press Escape to cancel.
        </p>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
        {hotkeyActions.map((action) => (
          <HotkeyRow
            key={action}
            action={action}
            currentKeys={hotkeys[action]}
            defaultKeys={defaultHotkeys[action]}
            onSave={async (keys) => {
              const newHotkeys = { ...settings.hotkeys };
              if (arraysEqual(keys, defaultHotkeys[action])) {
                // Remove from settings if it matches default (use default)
                delete newHotkeys[action];
              } else {
                // Store the keys (including empty array to disable)
                newHotkeys[action] = keys;
              }
              await patchModel(settings, { hotkeys: newHotkeys });
            }}
            onReset={async () => {
              const newHotkeys = { ...settings.hotkeys };
              delete newHotkeys[action];
              await patchModel(settings, { hotkeys: newHotkeys });
            }}
          />
        ))}
      </div>
    </VStack>
  );
}

interface HotkeyRowProps {
  action: HotkeyAction;
  currentKeys: string[];
  defaultKeys: string[];
  onSave: (keys: string[]) => Promise<void>;
  onReset: () => Promise<void>;
}

function HotkeyRow({ action, currentKeys, defaultKeys, onSave, onReset }: HotkeyRowProps) {
  const label = useHotKeyLabel(action);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedKey, setRecordedKey] = useState<string | null>(null);
  const recorderRef = useRef<HTMLDivElement>(null);
  const isCustomized = !arraysEqual(currentKeys, defaultKeys);
  const isDisabled = currentKeys.length === 0;

  const handleStartRecording = useCallback(() => {
    setRecordedKey(null);
    setIsRecording(true);
  }, []);

  const handleCancel = useCallback(() => {
    setIsRecording(false);
    setRecordedKey(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (recordedKey) {
      await onSave([recordedKey]);
    }
    setIsRecording(false);
    setRecordedKey(null);
  }, [recordedKey, onSave]);

  // Focus the recorder when we start recording
  useEffect(() => {
    if (isRecording && recorderRef.current) {
      recorderRef.current.focus();
    }
  }, [isRecording]);

  // Handle key capture
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        handleCancel();
        return;
      }

      const hotkeyString = eventToHotkeyString(e);
      if (hotkeyString) {
        setRecordedKey(hotkeyString);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isRecording, handleCancel]);

  return (
    <>
      <span className="text-sm">{label}</span>
      {isRecording ? (
        <HStack space={1}>
          <div
            ref={recorderRef}
            tabIndex={0}
            data-disable-hotkey
            className="w-48 px-2 py-1 text-xs font-mono bg-surface-highlight border border-border-subtle rounded focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {recordedKey ?? 'Press keys...'}
          </div>
          <Button size="xs" color="primary" onClick={handleSave} disabled={!recordedKey}>
            Save
          </Button>
          <Button size="xs" color="secondary" onClick={handleCancel}>
            Cancel
          </Button>
        </HStack>
      ) : (
        <HStack space={1}>
          <code
            className="text-xs bg-surface-highlight px-1.5 py-0.5 rounded cursor-pointer hover:bg-surface-active"
            onClick={handleStartRecording}
          >
            {isDisabled ? '(disabled)' : currentKeys.join(', ')}
          </code>
          {isCustomized && (
            <span className="text-xs text-notice" title={`Default: ${defaultKeys.join(', ')}`}>
              (customized)
            </span>
          )}
        </HStack>
      )}
      <HStack space={1}>
        <Button size="xs" color="secondary" onClick={handleStartRecording}>
          Edit
        </Button>
        {!isDisabled && (
          <Button size="xs" color="secondary" onClick={() => onSave([])}>
            Clear
          </Button>
        )}
        {isCustomized && (
          <Button size="xs" color="secondary" onClick={onReset}>
            Reset
          </Button>
        )}
      </HStack>
    </>
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}
