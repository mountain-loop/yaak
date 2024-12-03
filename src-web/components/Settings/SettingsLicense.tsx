import { type } from '@tauri-apps/plugin-os';
import type { ActivateLicenseRequestPayload } from '@yaakapp-internal/license';
import { useLicense } from '@yaakapp-internal/license';
import { format, formatDistanceToNow } from 'date-fns';
import React, { useState } from 'react';
import { appInfo } from '../../hooks/useAppInfo';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import { PlainInput } from '../core/PlainInput';
import { VStack } from '../core/Stacks';

export function SettingsLicense() {
  const { check, activate } = useLicense();
  const [key, setKey] = useState<string>('');

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
          <strong>Your trial ended on {format(check.data.end, 'MMMM dd, yyyy')}</strong>. If
          you&apos;re using Yaak for commercial use, please purchase a commercial use license.
        </Banner>
      )}
      {check.data?.type === 'personal_use' && <Banner color="info">You&apos;re</Banner>}
      {check.data?.type === 'commercial_use' && (
        <Banner color="primary">Your license is active</Banner>
      )}

      <VStack
        as="form"
        space={3}
        onSubmit={async (e) => {
          e.preventDefault();
          const resp = await activate.mutateAsync({ licenseKey: key });
          console.log(resp);
        }}
      >
        <PlainInput
          label="License Key"
          name="key"
          onChange={setKey}
          placeholder="YK1-XXXXX-XXXXX-XXXXX-XXXXX"
        />
        <Button type="submit" color="primary" size="sm" className="ml-auto">
          Activate License
        </Button>
      </VStack>
    </div>
  );
}
