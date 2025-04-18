import { openUrl } from '@tauri-apps/plugin-opener';
import { useLicense } from '@yaakapp-internal/license';
import { differenceInDays } from 'date-fns';
import React, { useState } from 'react';
import { useLicenseConfirmation } from '../../hooks/useLicenseConfirmation';
import { useToggle } from '../../hooks/useToggle';
import { pluralizeCount } from '../../lib/pluralize';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import { Checkbox } from '../core/Checkbox';
import { Icon } from '../core/Icon';
import { Link } from '../core/Link';
import { PlainInput } from '../core/PlainInput';
import { HStack, VStack } from '../core/Stacks';

export function SettingsLicense() {
  const { check, activate, deactivate } = useLicense();
  const [key, setKey] = useState<string>('');
  const [activateFormVisible, toggleActivateFormVisible] = useToggle(false);
  const [licenseDetails, setLicenseDetails] = useLicenseConfirmation();
  const [checked, setChecked] = useState<boolean>(false);

  if (check.isPending) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      {check.data?.type === 'commercial_use' ? (
        <Banner color="success">
          <strong>License active!</strong> Enjoy using Yaak for commercial use.
        </Banner>
      ) : check.data?.type == 'trialing' ? (
        <Banner color="success" className="flex flex-col gap-3 max-w-lg">
          <p className="select-text">
            You have{' '}
            <strong>
              {pluralizeCount('day', differenceInDays(check.data.end, new Date()))} remaining
            </strong>{' '}
            on your commercial use trial. Once the trial ends you agree to only use Yaak for
            personal use until a license is activated.
          </p>
        </Banner>
      ) : check.data?.type == 'personal_use' && !licenseDetails?.confirmedPersonalUse ? (
        <Banner color="success" className="flex flex-col gap-3 max-w-lg">
          <p className="select-text">
            Your 30-day trial has ended. Please activate a license or confirm how you&apos;re using
            Yaak.
          </p>
          <form
            className="flex flex-col gap-3 items-start"
            onSubmit={async (e) => {
              e.preventDefault();
              await setLicenseDetails((v) => ({
                ...v,
                confirmedPersonalUse: true,
              }));
            }}
          >
            <Checkbox
              checked={checked}
              onChange={setChecked}
              title="I am only using Yaak for personal use"
            />
            <Button type="submit" disabled={!checked} size="xs" variant="border" color="success">
              Confirm
            </Button>
          </form>
        </Banner>
      ) : null}

      <p className="select-text">
        A commercial license is required if using Yaak within a for-profit organization.{' '}
        <Link href="https://yaak.app/pricing" className="text-notice">
          Learn More
        </Link>
      </p>

      {check.error && <Banner color="danger">{check.error}</Banner>}
      {activate.error && <Banner color="danger">{activate.error}</Banner>}

      {check.data?.type === 'commercial_use' ? (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={() => {
            deactivate.mutate();
          }}>
            Deactivate License
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => openUrl('https://yaak.app/dashboard')}
            rightSlot={<Icon icon="external_link" />}
          >
            Direct Support
          </Button>
        </HStack>
      ) : (
        <HStack space={2}>
          <Button color="primary" size="sm" onClick={toggleActivateFormVisible}>
            Activate
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => openUrl('https://yaak.app/pricing?ref=app.yaak.desktop')}
            rightSlot={<Icon icon="external_link" />}
          >
            Purchase
          </Button>
        </HStack>
      )}

      {activateFormVisible && (
        <VStack
          as="form"
          space={3}
          className="max-w-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            await activate.mutateAsync({ licenseKey: key });
            toggleActivateFormVisible();
          }}
        >
          <PlainInput
            autoFocus
            label="License Key"
            name="key"
            onChange={setKey}
            placeholder="YK1-XXXXX-XXXXX-XXXXX-XXXXX"
          />
          <Button type="submit" color="primary" size="sm" isLoading={activate.isPending}>
            Submit
          </Button>
        </VStack>
      )}
    </div>
  );
}
