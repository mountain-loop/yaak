import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { fuzzyMatch } from 'fuzzbunny';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  defaultHotkeys,
  formatHotkeyString,
  getHotkeyScope,
  type HotkeyAction,
  hotkeyActions,
  hotkeysAtom,
  useHotkeyLabel,
} from '../../hooks/useHotKey';
import { capitalize } from '../../lib/capitalize';
import { showDialog } from '../../lib/dialog';
import { Button } from '../core/Button';
import { Dropdown, type DropdownItem } from '../core/Dropdown';
import { Heading } from '../core/Heading';
import { HotkeyRaw } from '../core/Hotkey';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';
import { PlainInput } from '../core/PlainInput';
import { HStack, VStack } from '../core/Stacks';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../core/Table';

const HOLD_KEYS = ['Shift', 'Control', 'Alt', 'Meta'];
const LAYOUT_INSENSITIVE_KEYS = [
  'Equal',
  'Minus',
  'BracketLeft',
  'BracketRight',
  'Backquote',
  'Space',
];

/** Convert a KeyboardEvent to a hotkey string like "Meta+Shift+k" or "Control+Shift+k" */
function eventToHotkeyString(e: KeyboardEvent): string | null {
  // Don't capture modifier-only key presses
  if (HOLD_KEYS.includes(e.key)) {
    return null;
  }

  const parts: string[] = [];

  // Add modifiers in consistent order (Meta, Control, Alt, Shift)
  if (e.metaKey) {
    parts.push('Meta');
  }
  if (e.ctrlKey) {
    parts.push('Control');
  }
  if (e.altKey) {
    parts.push('Alt');
  }
  if (e.shiftKey) {
    parts.push('Shift');
  }

  // Get the main key - use the same logic as useHotKey.ts
  const key = LAYOUT_INSENSITIVE_KEYS.includes(e.code) ? e.code : e.key;
  parts.push(key);

  return parts.join('+');
}

export function SettingsHotkeys() {
  const settings = useAtomValue(settingsAtom);
  const hotkeys = useAtomValue(hotkeysAtom);
  const [filter, setFilter] = useState('');

  const filteredActions = useMemo(() => {
    if (!filter.trim()) {
      return hotkeyActions;
    }
    return hotkeyActions.filter((action) => {
      const scope = getHotkeyScope(action).replace(/_/g, ' ');
      const label = action.replace(/[_.]/g, ' ');
      const searchText = `${scope} ${label}`;
      return fuzzyMatch(searchText, filter) != null;
    });
  }, [filter]);

  if (settings == null) {
    return null;
  }

  return (
    <VStack space={3} className="mb-4">
      <div className="mb-3">
        <Heading>Keyboard Shortcuts</Heading>
        <p className="text-text-subtle">
          Click the menu button to add, remove, or reset keyboard shortcuts.
        </p>
      </div>
      <PlainInput
        label="Filter"
        placeholder="Filter shortcuts..."
        defaultValue={filter}
        onChange={setFilter}
        hideLabel
        containerClassName="max-w-xs"
      />
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Scope</TableHeaderCell>
            <TableHeaderCell>Action</TableHeaderCell>
            <TableHeaderCell>Shortcut</TableHeaderCell>
            <TableHeaderCell></TableHeaderCell>
          </TableRow>
        </TableHead>
        {/* key={filter} forces re-render on filter change to fix Safari table rendering bug */}
        <TableBody key={filter}>
          {filteredActions.map((action) => (
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
        </TableBody>
      </Table>
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
  const label = useHotkeyLabel(action);
  const scope = capitalize(getHotkeyScope(action).replace(/_/g, ' '));
  const isCustomized = !arraysEqual(currentKeys, defaultKeys);
  const isDisabled = currentKeys.length === 0;

  const handleStartRecording = useCallback(() => {
    showDialog({
      id: `record-hotkey-${action}`,
      title: label,
      size: 'sm',
      render: ({ hide }) => (
        <RecordHotkeyDialog
          label={label}
          onSave={async (key) => {
            await onSave([...currentKeys, key]);
            hide();
          }}
          onCancel={hide}
        />
      ),
    });
  }, [action, label, currentKeys, onSave]);

  const handleRemove = useCallback(
    async (keyToRemove: string) => {
      const newKeys = currentKeys.filter((k) => k !== keyToRemove);
      await onSave(newKeys);
    },
    [currentKeys, onSave],
  );

  const handleClearAll = useCallback(async () => {
    await onSave([]);
  }, [onSave]);

  // Build dropdown items dynamically
  const dropdownItems: DropdownItem[] = [
    {
      label: 'Add Keyboard Shortcut',
      leftSlot: <Icon icon="plus" />,
      onSelect: handleStartRecording,
    },
  ];

  // Add remove options for each existing shortcut
  if (!isDisabled) {
    currentKeys.forEach((key) => {
      dropdownItems.push({
        label: (
          <HStack space={1.5}>
            <span>Remove</span>
            <HotkeyRaw labelParts={formatHotkeyString(key)} variant="with-bg" className="text-xs" />
          </HStack>
        ),
        leftSlot: <Icon icon="trash" />,
        onSelect: () => handleRemove(key),
      });
    });

    if (currentKeys.length > 1) {
      dropdownItems.push(
        {
          type: 'separator',
        },
        {
          label: 'Remove All Shortcuts',
          leftSlot: <Icon icon="trash" />,
          onSelect: handleClearAll,
        },
      );
    }
  }

  if (isCustomized) {
    dropdownItems.push({
      type: 'separator',
    });
    dropdownItems.push({
      label: 'Reset to Default',
      leftSlot: <Icon icon="refresh" />,
      onSelect: onReset,
    });
  }

  return (
    <TableRow>
      <TableCell>
        <span className="text-sm text-text-subtlest">{scope}</span>
      </TableCell>
      <TableCell>
        <span className="text-sm">{label}</span>
      </TableCell>
      <TableCell>
        <HStack space={1.5} className="py-1">
          {isDisabled ? (
            <span className="text-text-subtlest">Disabled</span>
          ) : (
            currentKeys.map((k) => (
              <HotkeyRaw key={k} labelParts={formatHotkeyString(k)} variant="with-bg" />
            ))
          )}
        </HStack>
      </TableCell>
      <TableCell align="right">
        <Dropdown items={dropdownItems}>
          <IconButton
            icon="ellipsis_vertical"
            size="sm"
            title="Hotkey actions"
            className="ml-auto text-text-subtlest"
          />
        </Dropdown>
      </TableCell>
    </TableRow>
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

interface RecordHotkeyDialogProps {
  label: string;
  onSave: (key: string) => void;
  onCancel: () => void;
}

function RecordHotkeyDialog({ label, onSave, onCancel }: RecordHotkeyDialogProps) {
  const [recordedKey, setRecordedKey] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        onCancel();
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
  }, [isFocused, onCancel]);

  const handleSave = useCallback(() => {
    if (recordedKey) {
      onSave(recordedKey);
    }
  }, [recordedKey, onSave]);

  return (
    <VStack space={4}>
      <div>
        <p className="text-text-subtle mb-2">
          Record a key combination for <span className="font-semibold">{label}</span>
        </p>
        <button
          type="button"
          data-disable-hotkey
          aria-label="Keyboard shortcut input"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onClick={(e) => {
            e.preventDefault();
            e.currentTarget.focus();
          }}
          className={classNames(
            'flex items-center justify-center',
            'px-4 py-2 rounded-lg bg-surface-highlight border outline-none cursor-default w-full',
            'border-border-subtle focus:border-border-focus',
          )}
        >
          {recordedKey ? (
            <HotkeyRaw labelParts={formatHotkeyString(recordedKey)} />
          ) : (
            <span className="text-text-subtlest">Press keys...</span>
          )}
        </button>
      </div>
      <HStack space={2} justifyContent="end">
        <Button color="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="primary" onClick={handleSave} disabled={!recordedKey}>
          Save
        </Button>
      </HStack>
    </VStack>
  );
}
