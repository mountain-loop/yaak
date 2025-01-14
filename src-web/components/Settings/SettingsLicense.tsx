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
import { openUrl } from '@tauri-apps/plugin-opener';

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
        <Banner color="primary" className="flex flex-col gap-3 max-w-lg">
          {check.data?.type === 'trialing' && (
            <p className="select-text">
              <strong>
                You have {formatDistanceToNow(check.data.end)} remaining on your trial.
              </strong>
            </p>
          )}
          <p className="select-text">
            A commercial license is required if using Yaak within a for-profit organization.{' '}
            <Link href="https://yaak.app/pricing" className="text-notice">
              Learn More
            </Link>
          </p>
          <p className="select-text">
            This supports future development and ensures continued growth and improvement. Personal
            use and running the open-source code directly require no license.
          </p>
          <p>~ Gregory</p>
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
            onClick={() => openUrl('https://yaak.app/dashboard')}
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
