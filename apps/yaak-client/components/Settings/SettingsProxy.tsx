import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';

import { Checkbox } from '../core/Checkbox';
import { Heading } from '../core/Heading';
import { InlineCode } from '../core/InlineCode';
import { PlainInput } from '../core/PlainInput';
import { Select } from '../core/Select';
import { Separator } from '../core/Separator';
import { HStack, VStack } from '../core/Stacks';

export function SettingsProxy() {
  const settings = useAtomValue(settingsAtom);

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-3">
        <Heading>Proxy</Heading>
        <p className="text-text-subtle">
          Configure a proxy server for HTTP requests. Useful for corporate firewalls, debugging
          traffic, or routing through specific infrastructure.
        </p>
      </div>
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
                bypass: '',
              },
            });
          } else {
            await patchModel(settings, { proxy: { type: 'disabled' } });
          }
        }}
        options={[
          { label: 'Automatic proxy detection', value: 'automatic' },
          { label: 'Custom proxy configuration', value: 'enabled' },
          { label: 'No proxy', value: 'disabled' },
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
              const bypass = proxy?.type === 'enabled' ? proxy.bypass : '';
              const auth = proxy?.type === 'enabled' ? proxy.auth : null;
              const disabled = !enabled;
              await patchModel(settings, {
                proxy: { type: 'enabled', http, https, auth, disabled, bypass },
              });
            }}
          />
          <HStack space={1.5}>
            <PlainInput
              size="sm"
              label={
                <>
                  Proxy for <InlineCode>http://</InlineCode> traffic
                </>
              }
              placeholder="localhost:9090"
              defaultValue={settings.proxy?.http}
              onChange={async (http) => {
                const { proxy } = settings;
                const https = proxy?.type === 'enabled' ? proxy.https : '';
                const bypass = proxy?.type === 'enabled' ? proxy.bypass : '';
                const auth = proxy?.type === 'enabled' ? proxy.auth : null;
                const disabled = proxy?.type === 'enabled' ? proxy.disabled : false;
                await patchModel(settings, {
                  proxy: {
                    type: 'enabled',
                    http,
                    https,
                    auth,
                    disabled,
                    bypass,
                  },
                });
              }}
            />
            <PlainInput
              size="sm"
              label={
                <>
                  Proxy for <InlineCode>https://</InlineCode> traffic
                </>
              }
              placeholder="localhost:9090"
              defaultValue={settings.proxy?.https}
              onChange={async (https) => {
                const { proxy } = settings;
                const http = proxy?.type === 'enabled' ? proxy.http : '';
                const bypass = proxy?.type === 'enabled' ? proxy.bypass : '';
                const auth = proxy?.type === 'enabled' ? proxy.auth : null;
                const disabled = proxy?.type === 'enabled' ? proxy.disabled : false;
                await patchModel(settings, {
                  proxy: { type: 'enabled', http, https, auth, disabled, bypass },
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
              const bypass = proxy?.type === 'enabled' ? proxy.bypass : '';
              const auth = enabled ? { user: '', password: '' } : null;
              await patchModel(settings, {
                proxy: { type: 'enabled', http, https, auth, disabled, bypass },
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
                  const bypass = proxy?.type === 'enabled' ? proxy.bypass : '';
                  const password = proxy?.type === 'enabled' ? (proxy.auth?.password ?? '') : '';
                  const auth = { user, password };
                  await patchModel(settings, {
                    proxy: { type: 'enabled', http, https, auth, disabled, bypass },
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
                  const bypass = proxy?.type === 'enabled' ? proxy.bypass : '';
                  const user = proxy?.type === 'enabled' ? (proxy.auth?.user ?? '') : '';
                  const auth = { user, password };
                  await patchModel(settings, {
                    proxy: { type: 'enabled', http, https, auth, disabled, bypass },
                  });
                }}
              />
            </HStack>
          )}
          {settings.proxy.type === 'enabled' && (
            <>
              <Separator className="my-6" />
              <PlainInput
                label="Proxy Bypass"
                help="Comma-separated list to bypass the proxy."
                defaultValue={settings.proxy.bypass}
                placeholder="127.0.0.1, *.example.com, localhost:3000"
                onChange={async (bypass) => {
                  const { proxy } = settings;
                  const http = proxy?.type === 'enabled' ? proxy.http : '';
                  const https = proxy?.type === 'enabled' ? proxy.https : '';
                  const disabled = proxy?.type === 'enabled' ? proxy.disabled : false;
                  const user = proxy?.type === 'enabled' ? (proxy.auth?.user ?? '') : '';
                  const password = proxy?.type === 'enabled' ? (proxy.auth?.password ?? '') : '';
                  const auth = { user, password };
                  await patchModel(settings, {
                    proxy: { type: 'enabled', http, https, auth, disabled, bypass },
                  });
                }}
              />
            </>
          )}
        </VStack>
      )}
    </VStack>
  );
}
