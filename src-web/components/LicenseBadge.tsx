import { openUrl } from '@tauri-apps/plugin-opener';
import type { LicenseCheckStatus } from '@yaakapp-internal/license';
import { useLicense } from '@yaakapp-internal/license';
import type { ReactNode } from 'react';
import { appInfo } from '../hooks/useAppInfo';
import { useOpenSettings } from '../hooks/useOpenSettings';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import {HStack} from "./core/Stacks";
import { SettingsTab } from './Settings/SettingsTab';
import { Icon } from './core/Icon';

const details: Record<
  LicenseCheckStatus['type'] | 'dev' | 'beta',
  { label: ReactNode; color: ButtonProps['color'] } | null
> = {
  beta: { label: <HStack space={1}><span>Beta Feedback</span><Icon size="xs" icon='external_link'/></HStack>, color: 'success' },
  dev: { label: 'Develop', color: 'secondary' },
  commercial_use: null,
  invalid_license: { label: 'License Error', color: 'danger' },
  personal_use: { label: 'Personal Use', color: 'primary' },
  trialing: { label: 'Personal Use', color: 'primary' },
};

export function LicenseBadge() {
  const openSettings = useOpenSettings(SettingsTab.License);
  const { check } = useLicense();

  if (check.data == null) {
    return null;
  }

  const checkType = appInfo.version.includes('beta')
    ? 'beta'
    : appInfo.isDev
      ? 'dev'
      : check.data.type;
  const detail = details[checkType];
  if (detail == null) {
    return null;
  }

  return (
    <Button
      size="2xs"
      variant="border"
      className="!rounded-full mx-1"
      onClick={async () => {
        if (checkType === 'beta') {
          await openUrl('https://feedback.yaak.app/p/yaak-20-feedback');
        } else {
          openSettings.mutate();
        }
      }}
      color={detail.color}
      event={{ id: 'license-badge', status: check.data.type }}
    >
      {detail.label}
    </Button>
  );
}
