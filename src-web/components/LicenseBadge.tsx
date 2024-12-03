import type { LicenseCheckStatus } from '@yaakapp-internal/license';
import { useLicense } from '@yaakapp-internal/license';
import { useOpenSettings } from '../hooks/useOpenSettings';
import { Button } from './core/Button';
import { SettingsTab } from './Settings/Settings';

const labels: Record<LicenseCheckStatus['type'], string | null> = {
  commercial_use: null,
  personal_use: 'Personal Use',
  trial_ended: 'Personal Use',
  trialing: 'Active Trial',
};

export function LicenseBadge() {
  const openSettings = useOpenSettings();
  const { check } = useLicense();

  if (check.data == null) {
    return null;
  }

  const label = labels[check.data.type];
  if (label == null) {
    return null;
  }

  return (
    <Button
      size="2xs"
      variant="border"
      className="!rounded-full mx-1"
      onClick={() => openSettings.mutate(SettingsTab.License)}
      color={
        check.data.type == 'trial_ended' || check.data.type === 'personal_use'
          ? 'primary'
          : 'success'
      }
    >
      {label}
    </Button>
  );
}
