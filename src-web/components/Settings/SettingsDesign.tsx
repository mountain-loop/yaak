import { open } from '@tauri-apps/plugin-dialog';
import React, { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { capitalize } from '../../lib/capitalize';
import { invokeCmd } from '../../lib/tauri';
import { getThemes } from '../../lib/theme/themes';
import { yaakDark } from '../../lib/theme/themes/yaak';
import { getThemeCSS } from '../../lib/theme/window';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import {Editor} from "../core/Editor/Editor";
import type { IconProps } from '../core/Icon';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';
import { InlineCode } from '../core/InlineCode';
import { Input } from '../core/Input';
import { Separator } from '../core/Separator';
import { HStack, VStack } from '../core/Stacks';

const buttonColors = [
  'primary',
  'secondary',
  'info',
  'success',
  'warning',
  'danger',
  'default',
] as const;

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

const themes = getThemes();

export function SettingsDesign() {
  const [exportDir, setExportDir] = useLocalStorage<string | null>('theme_export_dir', null);
  const [loadingExport, setLoadingExport] = useState<boolean>(false);

  const saveThemes = () => {
    setLoadingExport(true);
    setTimeout(async () => {
      const allThemesCSS = themes.themes.map(getThemeCSS).join('\n\n');
      const coreThemeCSS = [yaakDark].map(getThemeCSS).join('\n\n');

      try {
        await invokeCmd('cmd_write_file_dev', {
          pathname: exportDir + '/themes-all.css',
          contents: allThemesCSS,
        });
        await invokeCmd('cmd_write_file_dev', {
          pathname: exportDir + '/themes-slim.css',
          contents: coreThemeCSS,
        });
      } catch (err) {
        console.log('FAILED', err);
      }
      setLoadingExport(false);
    }, 500);
  };

  return (
    <div className="p-2 flex flex-col gap-3">
      <VStack space={2}>
        <InlineCode>{exportDir}</InlineCode>
        <HStack space={2}>
          <Button
            size="sm"
            color="secondary"
            variant="border"
            onClick={() => {
              open({ directory: true }).then(setExportDir);
            }}
          >
            Change Export Dir
          </Button>
          <Button
            disabled={exportDir == null}
            isLoading={loadingExport}
            size="sm"
            color="primary"
            variant="border"
            onClick={saveThemes}
          >
            Export CSS
          </Button>
        </HStack>
      </VStack>
      <Separator className="my-6" />
      <Input
        label="Field Label"
        name="demo"
        placeholder="Placeholder"
        size="sm"
        rightSlot={<IconButton title="search" size="xs" className="w-8 m-0.5" icon="search" />}
      />
      <Editor
        defaultValue={[
          '// Demo code editor',
          'let foo = {',
          '  foo: ("bar" || "baz" ?? \'qux\'),',
          '  baz: [1, 10.2, null, false, true],',
          '};',
        ].join('\n')}
        heightMode="auto"
        language="javascript"
      />
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1">
          {buttonColors.map((c, i) => (
            <Button key={c} color={c} size="sm" leftSlot={<Icon size="sm" icon={icons[i]!} />}>
              {capitalize(c).slice(0, 4)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {buttonColors.map((c, i) => (
            <Button
              key={c}
              color={c}
              variant="border"
              size="sm"
              leftSlot={<Icon size="sm" icon={icons[i]!} />}
            >
              {capitalize(c).slice(0, 4)}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {icons.map((v, i) => (
            <IconButton
              color={buttonColors[i % buttonColors.length]}
              title={v}
              variant="border"
              size="sm"
              key={v}
              icon={v}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Banner color="primary">Primary banner</Banner>
        <Banner color="secondary">Secondary banner</Banner>
        <Banner color="danger">Danger banner</Banner>
        <Banner color="warning">Warning banner</Banner>
        <Banner color="success">Success banner</Banner>
      </div>
    </div>
  );
}
