import type { LicenseCheckStatus } from '@yaakapp-internal/license';
import { useLicense } from '@yaakapp-internal/license';
import { useOpenSettings } from '../hooks/useOpenSettings';
import { Button } from './core/Button';
import { SettingsTab } from './Settings/Settings';

const labels: Record<LicenseCheckStatus['type'], string | null> = {
  commercial_use: null,
  personal_use: 'Personal Use',
  trial_ended: 'Trial Ended',
  trialing: 'Free Trial',
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
      color={
        check.data.type == 'trial_ended'
          ? 'warning'
          : check.data.type == 'personal_use'
            ? 'notice'
            : 'success'
      }
      variant="border"
      className="!rounded-full mx-1"
      onClick={() => openSettings.mutate(SettingsTab.License)}
    >
      {label}
    </Button>
  );
}
