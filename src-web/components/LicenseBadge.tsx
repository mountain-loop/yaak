import type { LicenseCheckStatus } from '@yaakapp-internal/license';
import { useLicense } from '@yaakapp-internal/license';
import type { ReactNode } from 'react';
import { openSettings } from '../commands/openSettings';
import { appInfo } from '../lib/appInfo';
import { useLicenseConfirmation } from '../hooks/useLicenseConfirmation';
import { BadgeButton } from './core/BadgeButton';
import type { ButtonProps } from './core/Button';

const details: Record<
  LicenseCheckStatus['type'],
  { label: ReactNode; color: ButtonProps['color'] } | null
> = {
  commercial_use: null,
  invalid_license: { label: 'License Error', color: 'danger' },
  personal_use: { label: 'Personal Use', color: 'notice' },
  trialing: { label: 'Personal Use', color: 'info' },
};

export function LicenseBadge() {
  const { check } = useLicense();
  const [licenseDetails, setLicenseDetails] = useLicenseConfirmation();

  if (appInfo.isDev) {
    return null;
  }

  if (check.error) {
    return (
      <BadgeButton color="danger" onClick={() => openSettings.mutate('license')}>
        License Error
      </BadgeButton>
    );
  }

  // Hasn't loaded yet
  if (licenseDetails == null || check.data == null) {
    return null;
  }

  // User has confirmed they are using Yaak for personal use only, so hide badge
  if (licenseDetails.confirmedPersonalUse) {
    return null;
  }

  // User is trialing but has already seen the message, so hide badge
  if (check.data.type === 'trialing' && licenseDetails.hasDismissedTrial) {
    return null;
  }

  const detail = details[check.data.type];
  if (detail == null) {
    return null;
  }

  return (
    <BadgeButton
      color={detail.color}
      onClick={async () => {
        if (check.data.type === 'trialing') {
          await setLicenseDetails((v) => ({
            ...v,
            hasDismissedTrial: true,
          }));
        }
        openSettings.mutate('license');
      }}
    >
      {detail.label}
    </BadgeButton>
  );
}
