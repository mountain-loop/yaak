import React from 'react';
import { useSettings } from '../../hooks/useSettings';
import { useUpdateSettings } from '../../hooks/useUpdateSettings';
import { Checkbox } from '../core/Checkbox';
import { PlainInput } from '../core/PlainInput';
import { Select } from '../core/Select';
import { Separator } from '../core/Separator';
import { HStack, VStack } from '../core/Stacks';

export function SettingsProxy() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  return (
    <VStack space={1.5} className="mb-4">
      <Select
        name="proxy"
        label="Proxy"
        hideLabel
        size="sm"
        value={settings.proxy?.type ?? 'automatic'}
        event="proxy"
        onChange={(v) => {
          if (v === 'automatic') {
            updateSettings.mutate({ proxy: undefined });
          } else if (v === 'enabled') {
            updateSettings.mutate({
              proxy: {
                type: 'enabled',
                http: '',
                https: '',
                auth: { user: '', password: '' },
              },
            });
          } else {
            updateSettings.mutate({ proxy: { type: 'disabled' } });
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
              onChange={(http) => {
                const https = settings.proxy?.type === 'enabled' ? settings.proxy.https : '';
                const auth = settings.proxy?.type === 'enabled' ? settings.proxy.auth : null;
                updateSettings.mutate({ proxy: { type: 'enabled', http, https, auth } });
              }}
            />
            <PlainInput
              size="sm"
              label="HTTPS"
              placeholder="localhost:9090"
              defaultValue={settings.proxy?.https}
              onChange={(https) => {
                const http = settings.proxy?.type === 'enabled' ? settings.proxy.http : '';
                const auth = settings.proxy?.type === 'enabled' ? settings.proxy.auth : null;
                updateSettings.mutate({ proxy: { type: 'enabled', http, https, auth } });
              }}
            />
          </HStack>
          <Separator className="my-6"/>
          <Checkbox
            checked={settings.proxy.auth != null}
            title="Enable authentication"
            onChange={(enabled) => {
              const http = settings.proxy?.type === 'enabled' ? settings.proxy.http : '';
              const https = settings.proxy?.type === 'enabled' ? settings.proxy.https : '';
              const auth = enabled ? { user: '', password: '' } : null;
              updateSettings.mutate({ proxy: { type: 'enabled', http, https, auth } });
            }}
          />

          {settings.proxy.auth != null && (
            <HStack space={1.5}>
              <PlainInput
                size="sm"
                label="User"
                placeholder="myUser"
                defaultValue={settings.proxy.auth.user}
                onChange={(user) => {
                  const https = settings.proxy?.type === 'enabled' ? settings.proxy.https : '';
                  const http = settings.proxy?.type === 'enabled' ? settings.proxy.http : '';
                  const password =
                    settings.proxy?.type === 'enabled' ? (settings.proxy.auth?.password ?? '') : '';
                  const auth = { user, password };
                  updateSettings.mutate({ proxy: { type: 'enabled', http, https, auth } });
                }}
              />
              <PlainInput
                size="sm"
                label="Password"
                type="password"
                placeholder="s3cretPassw0rd"
                defaultValue={settings.proxy.auth.password}
                onChange={(password) => {
                  const https = settings.proxy?.type === 'enabled' ? settings.proxy.https : '';
                  const http = settings.proxy?.type === 'enabled' ? settings.proxy.http : '';
                  const user =
                    settings.proxy?.type === 'enabled' ? (settings.proxy.auth?.user ?? '') : '';
                  const auth = { user, password };
                  updateSettings.mutate({ proxy: { type: 'enabled', http, https, auth } });
                }}
              />
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
}
