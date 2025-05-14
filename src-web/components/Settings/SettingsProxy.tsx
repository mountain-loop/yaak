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
                disabled: false,
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
          <Checkbox
            className="my-3"
            checked={!settings.proxy.disabled}
            title="Enable proxy"
            help="Use this to temporarily disable the proxy without losing the configuration"
            onChange={async (enabled) => {
              const { proxy } = settings;
              const http = proxy?.type === 'enabled' ? proxy.http : '';
              const https = proxy?.type === 'enabled' ? proxy.https : '';
              const auth = proxy?.type === 'enabled' ? proxy.auth : null;
              const disabled = !enabled;
              await patchModel(settings, {
                proxy: { type: 'enabled', http, https, auth, disabled },
              });
            }}
          />
          <HStack space={1.5}>
            <PlainInput
              size="sm"
              label="HTTP"
              placeholder="localhost:9090"
              defaultValue={settings.proxy?.http}
              onChange={async (http) => {
                const { proxy } = settings;
                const https = proxy?.type === 'enabled' ? proxy.https : '';
                const auth = proxy?.type === 'enabled' ? proxy.auth : null;
                const disabled = proxy?.type === 'enabled' ? proxy.disabled : false;
                await patchModel(settings, {
                  proxy: {
                    type: 'enabled',
                    http,
                    https,
                    auth,
                    disabled,
                  },
                });
              }}
            />
            <PlainInput
              size="sm"
              label="HTTPS"
              placeholder="localhost:9090"
              defaultValue={settings.proxy?.https}
              onChange={async (https) => {
                const { proxy } = settings;
                const http = proxy?.type === 'enabled' ? proxy.http : '';
                const auth = proxy?.type === 'enabled' ? proxy.auth : null;
                const disabled = proxy?.type === 'enabled' ? proxy.disabled : false;
                await patchModel(settings, {
                  proxy: { type: 'enabled', http, https, auth, disabled },
                });
              }}
            />
          </HStack>
          <Separator className="my-6" />
          <Checkbox
            checked={settings.proxy.auth != null}
            title="Enable authentication"
            onChange={async (enabled) => {
              const { proxy } = settings;
              const http = proxy?.type === 'enabled' ? proxy.http : '';
              const https = proxy?.type === 'enabled' ? proxy.https : '';
              const disabled = proxy?.type === 'enabled' ? proxy.disabled : false;
              const auth = enabled ? { user: '', password: '' } : null;
              await patchModel(settings, {
                proxy: { type: 'enabled', http, https, auth, disabled },
              });
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
                  const { proxy } = settings;
                  const http = proxy?.type === 'enabled' ? proxy.http : '';
                  const https = proxy?.type === 'enabled' ? proxy.https : '';
                  const disabled = proxy?.type === 'enabled' ? proxy.disabled : false;
                  const password = proxy?.type === 'enabled' ? (proxy.auth?.password ?? '') : '';
                  const auth = { user, password };
                  await patchModel(settings, {
                    proxy: { type: 'enabled', http, https, auth, disabled },
                  });
                }}
              />
              <PlainInput
                size="sm"
                label="Password"
                type="password"
                placeholder="s3cretPassw0rd"
                defaultValue={settings.proxy.auth.password}
                onChange={async (password) => {
                  const { proxy } = settings;
                  const http = proxy?.type === 'enabled' ? proxy.http : '';
                  const https = proxy?.type === 'enabled' ? proxy.https : '';
                  const disabled = proxy?.type === 'enabled' ? proxy.disabled : false;
                  const user = proxy?.type === 'enabled' ? (proxy.auth?.user ?? '') : '';
                  const auth = { user, password };
                  await patchModel(settings, {
                    proxy: { type: 'enabled', http, https, auth, disabled },
                  });
                }}
              />
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
}
