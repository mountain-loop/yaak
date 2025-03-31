import type { EditorKeymap } from '@yaakapp-internal/models';
import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import React from 'react';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { useResolvedAppearance } from '../../hooks/useResolvedAppearance';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { clamp } from '../../lib/clamp';
import { getThemes } from '../../lib/theme/themes';
import { isThemeDark } from '../../lib/theme/window';
import type { ButtonProps } from '../core/Button';
import { Checkbox } from '../core/Checkbox';
import { Editor } from '../core/Editor/Editor';
import type { IconProps } from '../core/Icon';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';
import type { SelectProps } from '../core/Select';
import { Select } from '../core/Select';
import { Separator } from '../core/Separator';
import { HStack, VStack } from '../core/Stacks';

const fontSizeOptions = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
].map((n) => ({ label: `${n}`, value: `${n}` }));

const keymaps: { value: EditorKeymap; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'vim', label: 'Vim' },
  { value: 'vscode', label: 'VSCode' },
  { value: 'emacs', label: 'Emacs' },
];

const buttonColors: ButtonProps['color'][] = [
  'primary',
  'info',
  'success',
  'notice',
  'warning',
  'danger',
  'secondary',
  'default',
];

const icons: IconProps['icon'][] = [
  'info',
  'box',
  'update',
  'alert_triangle',
  'arrow_big_right_dash',
  'download',
  'copy',
  'magic_wand',
  'settings',
  'trash',
  'sparkles',
  'pencil',
  'paste',
  'search',
  'send_horizontal',
];

const { themes } = getThemes();

export function SettingsAppearance() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const settings = useAtomValue(settingsAtom);
  const appearance = useResolvedAppearance();
  const activeTheme = useResolvedTheme();

  if (settings == null || workspace == null) {
    return null;
  }

  const lightThemes: SelectProps<string>['options'] = themes
    .filter((theme) => !isThemeDark(theme))
    .map((theme) => ({
      label: theme.name,
      value: theme.id,
    }));

  const darkThemes: SelectProps<string>['options'] = themes
    .filter((theme) => isThemeDark(theme))
    .map((theme) => ({
      label: theme.name,
      value: theme.id,
    }));

  return (
    <VStack space={2} className="mb-4">
      <Select
        size="sm"
        name="interfaceFontSize"
        label="Font Size"
        labelPosition="left"
        defaultValue="15"
        value={`${settings.interfaceFontSize}`}
        options={fontSizeOptions}
        onChange={(v) => patchModel(settings, { interfaceFontSize: parseInt(v) })}
      />
      <Select
        size="sm"
        name="editorFontSize"
        label="Editor Font Size"
        labelPosition="left"
        defaultValue="13"
        value={`${settings.editorFontSize}`}
        options={fontSizeOptions}
        onChange={(v) => patchModel(settings, { editorFontSize: clamp(parseInt(v) || 14, 8, 30) })}
      />
      <Select
        size="sm"
        name="editorKeymap"
        label="Editor Keymap"
        labelPosition="left"
        value={`${settings.editorKeymap}`}
        options={keymaps}
        onChange={(v) => patchModel(settings, { editorKeymap: v })}
      />
      <Checkbox
        checked={settings.editorSoftWrap}
        title="Wrap Editor Lines"
        onChange={(editorSoftWrap) => patchModel(settings, { editorSoftWrap })}
      />

      <Separator className="my-4" />

      <Select
        name="appearance"
        label="Appearance"
        labelPosition="top"
        size="sm"
        value={settings.appearance}
        onChange={(appearance) => patchModel(settings, { appearance })}
        options={[
          { label: 'Automatic', value: 'system' },
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
        ]}
      />
      <HStack space={2}>
        {(settings.appearance === 'system' || settings.appearance === 'light') && (
          <Select
            hideLabel
            leftSlot={<Icon icon="sun" />}
            name="lightTheme"
            label="Light Theme"
            size="sm"
            className="flex-1"
            value={activeTheme.light.id}
            options={lightThemes}
            onChange={(themeLight) => patchModel(settings, { themeLight })}
          />
        )}
        {(settings.appearance === 'system' || settings.appearance === 'dark') && (
          <Select
            hideLabel
            name="darkTheme"
            className="flex-1"
            label="Dark Theme"
            leftSlot={<Icon icon="moon" />}
            size="sm"
            value={activeTheme.dark.id}
            options={darkThemes}
            onChange={(themeDark) => patchModel(settings, { themeDark })}
          />
        )}
      </HStack>

      <VStack
        space={3}
        className="mt-3 w-full bg-surface p-3 border border-dashed border-border-subtle rounded overflow-x-auto"
      >
        <HStack className="text" space={1.5}>
          <Icon icon={appearance === 'dark' ? 'moon' : 'sun'} />
          <strong>{activeTheme.active.name}</strong>
          <em>(preview)</em>
        </HStack>
        <HStack space={1.5} className="w-full">
          {buttonColors.map((c, i) => (
            <IconButton
              key={c}
              color={c}
              size="2xs"
              iconSize="xs"
              icon={icons[i % icons.length]!}
              iconClassName="text"
              title={`${c}`}
            />
          ))}
          {buttonColors.map((c, i) => (
            <IconButton
              key={c}
              color={c}
              variant="border"
              size="2xs"
              iconSize="xs"
              icon={icons[i % icons.length]!}
              iconClassName="text"
              title={`${c}`}
            />
          ))}
        </HStack>
        <Editor
          defaultValue={[
            'let foo = { // Demo code editor',
            '  foo: ("bar" || "baz" ?? \'qux\'),',
            '  baz: [1, 10.2, null, false, true],',
            '};',
          ].join('\n')}
          heightMode="auto"
          language="javascript"
          stateKey={null}
        />
      </VStack>
    </VStack>
  );
}
