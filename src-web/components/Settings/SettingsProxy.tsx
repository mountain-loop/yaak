import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import React from 'react';
import { Checkbox } from '../core/Checkbox';
import { PlainInput } from '../core/PlainInput';
import { Select } from '../core/Select';
import { Separator } from '../core/Separator';
import { HStack, VStack } from '../core/Stacks';

export function SettingsProxy() {
  const settings = useAtomValue(settingsAtom);

  return (
    <VStack space={1.5} className="mb-4">
      <Select
        name="proxy"
        label="Proxy"
        hideLabel
        size="sm"
        value={settings.proxy?.type ?? 'automatic'}
        onChange={async (v) => {
          if (v === 'automatic') {
            await patchModel(settings, { proxy: undefined });
          } else if (v === 'enabled') {
            await patchModel(settings, {
              proxy: {
                type: 'enabled',
                http: '',
                https: '',
                auth: { user: '', password: '' },
              },
            });
          } else {
            await patchModel(settings, { proxy: { type: 'disabled' } });
          }
        }}
        options={[
          { label: 'Automatic Proxy Detection', value: 'automatic' },
          { label: 'Custom Proxy Configuration', value: 'enabled' },
          { label: 'No Proxy', value: 'disabled' },
        ]}
      />
      {settings.proxy?.type === 'enabled' && (
        <VStack space={1.5}>
          <HStack space={1.5} className="mt-3">
            <PlainInput
              size="sm"
              label="HTTP"
              placeholder="localhost:9090"
              defaultValue={settings.proxy?.http}
              onChange={async (http) => {
                const https = settings.proxy?.type === 'enabled' ? settings.proxy.https : '';
                const auth = settings.proxy?.type === 'enabled' ? settings.proxy.auth : null;
                await patchModel(settings, { proxy: { type: 'enabled', http, https, auth } });
              }}
            />
            <PlainInput
              size="sm"
              label="HTTPS"
              placeholder="localhost:9090"
              defaultValue={settings.proxy?.https}
              onChange={async (https) => {
                const http = settings.proxy?.type === 'enabled' ? settings.proxy.http : '';
                const auth = settings.proxy?.type === 'enabled' ? settings.proxy.auth : null;
                await patchModel(settings, { proxy: { type: 'enabled', http, https, auth } });
              }}
            />
          </HStack>
          <Separator className="my-6" />
          <Checkbox
            checked={settings.proxy.auth != null}
            title="Enable authentication"
            onChange={async (enabled) => {
              const http = settings.proxy?.type === 'enabled' ? settings.proxy.http : '';
              const https = settings.proxy?.type === 'enabled' ? settings.proxy.https : '';
              const auth = enabled ? { user: '', password: '' } : null;
              await patchModel(settings, { proxy: { type: 'enabled', http, https, auth } });
            }}
          />

          {settings.proxy.auth != null && (
            <HStack space={1.5}>
              <PlainInput
                required
                size="sm"
                label="User"
                placeholder="myUser"
                defaultValue={settings.proxy.auth.user}
                onChange={async (user) => {
                  const https = settings.proxy?.type === 'enabled' ? settings.proxy.https : '';
                  const http = settings.proxy?.type === 'enabled' ? settings.proxy.http : '';
                  const password =
                    settings.proxy?.type === 'enabled' ? (settings.proxy.auth?.password ?? '') : '';
                  const auth = { user, password };
                  await patchModel(settings, { proxy: { type: 'enabled', http, https, auth } });
                }}
              />
              <PlainInput
                size="sm"
                label="Password"
                type="password"
                placeholder="s3cretPassw0rd"
                defaultValue={settings.proxy.auth.password}
                onChange={async (password) => {
                  const https = settings.proxy?.type === 'enabled' ? settings.proxy.https : '';
                  const http = settings.proxy?.type === 'enabled' ? settings.proxy.http : '';
                  const user =
                    settings.proxy?.type === 'enabled' ? (settings.proxy.auth?.user ?? '') : '';
                  const auth = { user, password };
                  await patchModel(settings, { proxy: { type: 'enabled', http, https, auth } });
                }}
              />
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
}
