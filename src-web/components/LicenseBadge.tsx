import type { LicenseCheckStatus } from '@yaakapp-internal/license';
import { useLicense } from '@yaakapp-internal/license';
import { settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { openSettings } from '../commands/openSettings';
import { CargoFeature } from './CargoFeature';
import { BadgeButton } from './core/BadgeButton';
import type { ButtonProps } from './core/Button';

const details: Record<
  LicenseCheckStatus['type'],
  { label: ReactNode; color: ButtonProps['color'] } | null
> = {
  commercial_use: null,
  invalid_license: { label: 'License Error', color: 'danger' },
  personal_use: { label: 'Personal Use', color: 'notice' },
  trialing: { label: 'Commercial Trial', color: 'secondary' },
};

export function LicenseBadge() {
  return (
    <CargoFeature feature="license">
      <LicenseBadgeCmp />
    </CargoFeature>
  );
}

function LicenseBadgeCmp() {
  const { check } = useLicense();
  const settings = useAtomValue(settingsAtom);

  if (check.error) {
    // Failed to check for license. Probably a network or server error so just don't
    // show anything.
    return null;
  }

  // Hasn't loaded yet
  if (check.data == null) {
    return null;
  }

  // Dismissed license badge
  if (settings.hideLicenseBadge) {
    return null;
  }

  const detail = details[check.data.type];
  if (detail == null) {
    return null;
  }

  return (
    <BadgeButton
      color={detail.color}
      onClick={() => openSettings.mutate('license')}
    >
      {detail.label}
    </BadgeButton>
  );
}
