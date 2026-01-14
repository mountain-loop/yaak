import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { lazy, Suspense } from 'react';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { useResolvedAppearance } from '../../hooks/useResolvedAppearance';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import type { ButtonProps } from '../core/Button';
import { Heading } from '../core/Heading';
import type { IconProps } from '../core/Icon';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';
import { Link } from '../core/Link';
import type { SelectProps } from '../core/Select';
import { Select } from '../core/Select';
import { HStack, VStack } from '../core/Stacks';

const Editor = lazy(() => import('../core/Editor/Editor').then((m) => ({ default: m.Editor })));

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

export function SettingsTheme() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const settings = useAtomValue(settingsAtom);
  const appearance = useResolvedAppearance();
  const activeTheme = useResolvedTheme();

  if (settings == null || workspace == null || activeTheme.data == null) {
    return null;
  }

  const lightThemes: SelectProps<string>['options'] = activeTheme.data.themes
    .filter((theme) => !theme.dark)
    .map((theme) => ({
      label: theme.label,
      value: theme.id,
    }));

  const darkThemes: SelectProps<string>['options'] = activeTheme.data.themes
    .filter((theme) => theme.dark)
    .map((theme) => ({
      label: theme.label,
      value: theme.id,
    }));

  return (
    <VStack space={3} className="mb-4">
      <div className="mb-3">
        <Heading>Theme</Heading>
        <p className="text-text-subtle">
          Make Yaak your own by selecting a theme, or{' '}
          <Link href="https://yaak.app/docs/plugin-development/plugins-quick-start">
            Create Your Own
          </Link>
        </p>
      </div>
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
            leftSlot={<Icon icon="sun" color="secondary" />}
            name="lightTheme"
            label="Light Theme"
            size="sm"
            className="flex-1"
            value={activeTheme.data.light.id}
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
            leftSlot={<Icon icon="moon" color="secondary" />}
            size="sm"
            value={activeTheme.data.dark.id}
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
          <strong>{activeTheme.data.active.label}</strong>
          <em>(preview)</em>
        </HStack>
        <HStack space={1.5} className="w-full">
          {buttonColors.map((c, i) => (
            <IconButton
              key={c}
              color={c}
              size="2xs"
              iconSize="xs"
              icon={icons[i % icons.length] ?? 'info'}
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
              icon={icons[i % icons.length] ?? 'info'}
              iconClassName="text"
              title={`${c}`}
            />
          ))}
        </HStack>
        <Suspense>
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
        </Suspense>
      </VStack>
    </VStack>
  );
}
