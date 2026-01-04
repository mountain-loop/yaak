import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useCallback, useState } from 'react';
import {
  defaultHotkeys,
  type HotkeyAction,
  hotkeyActions,
  hotkeysAtom,
  useHotKeyLabel,
} from '../../hooks/useHotKey';
import { Button } from '../core/Button';
import { Heading } from '../core/Heading';
import { PlainInput } from '../core/PlainInput';
import { HStack, VStack } from '../core/Stacks';

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
          Customize keyboard shortcuts. Use format like "CmdCtrl+k" or "Shift+Enter". CmdCtrl maps
          to Cmd on macOS and Ctrl on Windows/Linux.
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
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const isCustomized = !arraysEqual(currentKeys, defaultKeys);
  const isDisabled = currentKeys.length === 0;

  const handleStartEdit = useCallback(() => {
    setEditValue(currentKeys.join(', '));
    setIsEditing(true);
  }, [currentKeys]);

  const handleSave = useCallback(async () => {
    const keys = editValue
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    await onSave(keys);
    setIsEditing(false);
  }, [editValue, onSave]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue('');
  }, []);

  const handleKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel],
  );

  return (
    <>
      <span className="text-sm">{label}</span>
      {isEditing ? (
        <HStack space={1}>
          <div data-disable-hotkey>
            <PlainInput
              name={`hotkey-${action}`}
              size="sm"
              autoFocus
              containerClassName="w-48"
              className="font-mono text-xs"
              defaultValue={editValue}
              onChange={setEditValue}
              onKeyDownCapture={handleKeyDownCapture}
              placeholder="e.g. CmdCtrl+Shift+k"
            />
          </div>
          <Button size="xs" color="primary" onClick={handleSave}>
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
            onClick={handleStartEdit}
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
        <Button size="xs" color="secondary" onClick={handleStartEdit}>
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
