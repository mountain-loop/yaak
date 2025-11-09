import { openUrl } from '@tauri-apps/plugin-opener';
import { useLicense } from '@yaakapp-internal/license';
import { differenceInDays } from 'date-fns';
import React, { useState } from 'react';
import { useToggle } from '../../hooks/useToggle';
import { pluralizeCount } from '../../lib/pluralize';
import { CargoFeature } from '../CargoFeature';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import { Icon } from '../core/Icon';
import { Link } from '../core/Link';
import { PlainInput } from '../core/PlainInput';
import { Separator } from '../core/Separator';
import { HStack, VStack } from '../core/Stacks';
import { LocalImage } from '../LocalImage';

export function SettingsLicense() {
  return (
    <CargoFeature feature="license">
      <SettingsLicenseCmp />
    </CargoFeature>
  );
}

function SettingsLicenseCmp() {
  const { check, activate, deactivate } = useLicense();
  const [key, setKey] = useState<string>('');
  const [activateFormVisible, toggleActivateFormVisible] = useToggle(false);

  if (check.isPending) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {check.data?.type === 'commercial_use' ? (
        <Banner color="success">Your license is active 🥳</Banner>
      ) : check.data?.type === 'trialing' ? (
        <Banner color="info" className="@container flex items-center gap-x-5 max-w-xl">
          <LocalImage src="static/greg.jpeg" className="hidden @sm:block rounded-full h-14 w-14" />
          <p className="w-full">
            <strong>{pluralizeCount('day', differenceInDays(check.data.end, new Date()))}</strong>{' '}
            left to evaluate Yaak for commercial use.
            <br />
            <span className="opacity-50">Personal use is always free, forever.</span>
            <Separator className="my-2" />
            <div className="flex flex-wrap items-center gap-x-2 text-sm text-notice">
              <Link noUnderline href="mailto:support@yaak.app">
                Contact Support
              </Link>
              <Icon icon="dot" size="sm" color="secondary" />
              <Link
                noUnderline
                href={`https://yaak.app/pricing?s=learn&t=${check.data?.type ?? ''}`}
              >
                Learn More
              </Link>
            </div>
          </p>
        </Banner>
      ) : check.data?.type === 'personal_use' ? (
        <Banner color="notice" className="@container flex items-center gap-x-5 max-w-xl">
          <LocalImage src="static/greg.jpeg" className="hidden @sm:block rounded-full h-14 w-14" />
          <p className="w-full">
            Your commercial-use trial has ended.
            <br />
            <span className="opacity-50">
              You can continue using Yaak for personal use free, forever.
              <br />
              A license is required for commercial use.
            </span>
            <Separator className="my-2" />
            <div className="flex flex-wrap items-center gap-x-2 text-sm text-notice">
              <Link noUnderline href="mailto:support@yaak.app">
                Contact Support
              </Link>
              <Icon icon="dot" size="sm" color="secondary" />
              <Link
                noUnderline
                href={`https://yaak.app/pricing?s=learn&t=${check.data?.type ?? ''}`}
              >
                Learn More
              </Link>
            </div>
          </p>
        </Banner>
      ) : null}

      {check.error && <Banner color="danger">{check.error}</Banner>}
      {activate.error && <Banner color="danger">{activate.error}</Banner>}

      {check.data?.type === 'invalid_license' && (
        <Banner color="danger">
          Your license is invalid. Please <Link href="https://yaak.app/dashboard">Sign In</Link> for
          more details
        </Banner>
      )}

      {check.data?.type === 'commercial_use' ? (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={() => deactivate.mutate()}>
            Deactivate License
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => openUrl('https://yaak.app/dashboard?s=support&ref=app.yaak.desktop')}
            rightSlot={<Icon icon="external_link" />}
          >
            Direct Support
          </Button>
        </HStack>
      ) : (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={toggleActivateFormVisible}>
            Activate License
          </Button>
          <Button
            size="sm"
            color="primary"
            rightSlot={<Icon icon="external_link" />}
            onClick={() =>
              openUrl(
                `https://yaak.app/pricing?s=purchase&ref=app.yaak.desktop&t=${check.data?.type ?? ''}`,
              )
            }
          >
            Purchase License
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
