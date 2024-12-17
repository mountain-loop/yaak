import { open } from '@tauri-apps/plugin-shell';
import { useLicense } from '@yaakapp-internal/license';
import { formatDistanceToNow } from 'date-fns';
import React, { useState } from 'react';
import { useToggle } from '../../hooks/useToggle';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import { Icon } from '../core/Icon';
import { Link } from '../core/Link';
import { PlainInput } from '../core/PlainInput';
import { HStack, VStack } from '../core/Stacks';

export function SettingsLicense() {
  const { check, activate } = useLicense();
  const [key, setKey] = useState<string>('');
  const [activateFormVisible, toggleActivateFormVisible] = useToggle(false);

  if (check.isPending) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {check.data?.type === 'commercial_use' ? (
        <Banner color="success">
          <strong>License active!</strong> Enjoy using Yaak for commercial use.
        </Banner>
      ) : (
        <Banner color="primary" className="flex flex-col gap-2">
          {check.data?.type === 'trialing' && (
            <p>
              <strong>Your trial ends in {formatDistanceToNow(check.data.end)}.</strong>
            </p>
          )}
          <p>
            A commercial license is required if using Yaak within a for-profit organization of two
            or more people. This helps support the ongoing development of Yaak and ensures continued
            growth and improvement.
          </p>
          <p>If you&#39;re using Yaak for personal use, no action is needed.</p>
          <p>~ Gregory</p>
          <Link href="https://yaak.app/pricing" className="text-sm text-text-subtle">
            Learn More
          </Link>
        </Banner>
      )}

      {check.error && <Banner color="danger">{check.error}</Banner>}
      {activate.error && <Banner color="danger">{activate.error}</Banner>}

      {check.data?.type === 'commercial_use' ? (
        <HStack space={2}>
          <Button
            variant="border"
            color="secondary"
            size="sm"
            onClick={toggleActivateFormVisible}
            event="license.another"
          >
            Activate Another License
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => open('https://yaak.app/dashboard')}
            rightSlot={<Icon icon="external_link" />}
            event="license.support"
          >
            Direct Support
          </Button>
        </HStack>
      ) : (
        <HStack space={2}>
          <Button
            color="primary"
            size="sm"
            onClick={toggleActivateFormVisible}
            event="license.activate"
          >
            Activate
          </Button>
          <Button
            color="secondary"
            size="sm"
            onClick={() => open('https://yaak.app/pricing?ref=app.yaak.desktop')}
            rightSlot={<Icon icon="external_link" />}
            event="license.purchase"
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
          <Button
            type="submit"
            color="primary"
            size="sm"
            isLoading={activate.isPending}
            event="license.submit"
          >
            Submit
          </Button>
        </VStack>
      )}
    </div>
  );
}
