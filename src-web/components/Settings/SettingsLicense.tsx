import { useLicense } from '@yaakapp-internal/license';
import { format, formatDistanceToNow } from 'date-fns';
import { open } from '@tauri-apps/plugin-shell';
import React, { useState } from 'react';
import { useToggle } from '../../hooks/useToggle';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import { Icon } from '../core/Icon';
import { PlainInput } from '../core/PlainInput';
import { HStack, VStack } from '../core/Stacks';

export function SettingsLicense() {
  const { check, activate } = useLicense();
  const [key, setKey] = useState<string>('');
  const [activateFormVisible, toggleActivateFormVisible] = useToggle(false);

  return (
    <div className="flex flex-col gap-4">
      {check.data?.type === 'trialing' && (
        <Banner color="success">
          <strong>Your trial ends in {formatDistanceToNow(check.data.end)}</strong>. If you&apos;re
          using Yaak for commercial use, please purchase a commercial use license.
        </Banner>
      )}
      {check.data?.type === 'trial_ended' && (
        <Banner color="primary">
          <strong>Your trial ended on {format(check.data.end, 'MMMM dd, yyyy')}</strong>. A
          commercial-use license is required if you use Yaak within a for-profit organization of two
          or more people.
        </Banner>
      )}
      {check.data?.type === 'personal_use' && <Banner color="info">You&apos;re</Banner>}
      {check.data?.type === 'commercial_use' && (
        <Banner color="success">
          <strong>License active!</strong> Enjoy using Yaak for commercial use.
        </Banner>
      )}

      {check.error && <Banner color="danger">{check.error}</Banner>}
      {activate.error && <Banner color="danger">{activate.error}</Banner>}

      {check.data?.type === 'commercial_use' ? (
        <HStack space={2}>
          <Button variant="border" color="secondary" size="sm" onClick={toggleActivateFormVisible}>
            Activate Another License
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => open('https://yaak.app/dashboard')}
            rightSlot={<Icon icon="external_link" />}
          >
            Direct Support
          </Button>
        </HStack>
      ) : (
        <HStack space={2}>
          <Button
            color="secondary"
            size="sm"
            onClick={() => open('https://yaak.app/pricing')}
            rightSlot={<Icon icon="external_link" />}
          >
            Purchase
          </Button>
          <Button color="primary" size="sm" onClick={toggleActivateFormVisible}>
            Activate License
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
            toggleActivateFormVisible();
            activate.mutate({ licenseKey: key });
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
