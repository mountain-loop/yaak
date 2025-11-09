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
      ) : check.data?.type == 'trialing' ? (
        <Banner color="info" className="flex flex-col gap-3 max-w-lg">
          <p>
            <strong>
              {pluralizeCount('day', differenceInDays(check.data.end, new Date()))} remaining
            </strong>{' '}
            on your commercial-use trial
          </p>
        </Banner>
      ) : check.data?.type == 'personal_use' ? (
        <Banner color="notice" className="flex flex-col gap-3 max-w-lg">
          <p>You are able to use Yaak for personal use only</p>
        </Banner>
      ) : null}

      {check.data?.type !== 'commercial_use' && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-6 items-center my-3 ">
          <LocalImage src="static/greg.jpeg" className="rounded-full h-20 w-20" />
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">Hey, I&apos;m Greg 👋🏼</h2>
            <p>
              Yaak is free for personal projects and learning.{' '}
              {check.data?.type === 'trialing' ? 'Once your trial ends, a ' : 'A '}
              license will be required for work or commercial use.
            </p>
            <p>
              <Link
                noUnderline
                href={`https://yaak.app/pricing?s=learn&t=${check.data?.type ?? ''}`}
                className="text-sm text-notice opacity-80 hover:opacity-100"
              >
                Learn More
              </Link>
            </p>
          </div>
        </div>
      )}

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
