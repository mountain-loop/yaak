import type { LicenseCheckStatus } from '@yaakapp-internal/license';
import { useLicense } from '@yaakapp-internal/license';
import { useOpenSettings } from '../hooks/useOpenSettings';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import { SettingsTab } from './Settings/Settings';

const details: Record<
  LicenseCheckStatus['type'],
  { label: string; color: ButtonProps['color'] } | null
> = {
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

  const detail = details[check.data.type];
  if (detail == null) {
    return null;
  }

  return (
    <Button
      size="2xs"
      variant="border"
      className="!rounded-full mx-1"
      onClick={() => openSettings.mutate()}
      color={detail.color}
      event={{ id: 'license-badge', status: check.data.type }}
    >
      {detail.label}
    </Button>
  );
}
