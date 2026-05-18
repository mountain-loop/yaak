import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import type { ProxySetting } from "@yaakapp-internal/models";
import { Heading, InlineCode, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import {
  SettingRowBoolean,
  SettingRowSelect,
  SettingRowText,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

export function SettingsProxy() {
  const settings = useAtomValue(settingsAtom);
  const proxy = enabledProxyOrDefault(settings.proxy);

  const patchProxy = async (patch: Partial<EnabledProxySetting>) => {
    await patchModel(settings, {
      proxy: {
        ...proxy,
        ...patch,
        auth: Object.hasOwn(patch, "auth") ? (patch.auth ?? null) : proxy.auth,
      },
    });
  };

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-3">
        <Heading>Proxy</Heading>
        <p className="text-text-subtle">
          Configure a proxy server for HTTP requests. Useful for corporate firewalls, debugging
          traffic, or routing through specific infrastructure.
        </p>
      </div>
      <SettingsList className="space-y-8">
        <SettingsSection title="Proxy">
          <SettingRowSelect
            title="Proxy"
            description="Choose how Yaak should discover or use proxy settings."
            name="proxy"
            value={settings.proxy?.type ?? "automatic"}
            onChange={async (v) => {
              if (v === "automatic") {
                await patchModel(settings, { proxy: undefined });
              } else if (v === "enabled") {
                await patchModel(settings, { proxy });
              } else {
                await patchModel(settings, { proxy: { type: "disabled" } });
              }
            }}
            options={[
              { label: "Automatic proxy detection", value: "automatic" },
              { label: "Custom proxy configuration", value: "enabled" },
              { label: "No proxy", value: "disabled" },
            ]}
            selectClassName="!w-64"
          />
        </SettingsSection>

        {settings.proxy?.type === "enabled" && (
          <>
            <SettingsSection title="Custom Proxy">
              <SettingRowBoolean
                checked={!settings.proxy.disabled}
                title="Enable proxy"
                description="Temporarily disable the proxy without losing the configuration."
                onChange={(enabled) => patchProxy({ disabled: !enabled })}
              />
              <SettingRowText
                name="proxyHttp"
                title={
                  <>
                    Proxy for <InlineCode>http://</InlineCode> traffic
                  </>
                }
                description="Proxy host used for unencrypted HTTP traffic."
                value={settings.proxy.http}
                placeholder="localhost:9090"
                onChange={(http) => patchProxy({ http })}
              />
              <SettingRowText
                name="proxyHttps"
                title={
                  <>
                    Proxy for <InlineCode>https://</InlineCode> traffic
                  </>
                }
                description="Proxy host used for HTTPS traffic."
                value={settings.proxy.https}
                placeholder="localhost:9090"
                onChange={(https) => patchProxy({ https })}
              />
              <SettingRowText
                name="proxyBypass"
                title="Proxy Bypass"
                description="Comma-separated list of hosts that should bypass the proxy."
                value={settings.proxy.bypass}
                placeholder="127.0.0.1, *.example.com, localhost:3000"
                inputWidthClassName="!w-96"
                onChange={(bypass) => patchProxy({ bypass })}
              />
            </SettingsSection>

            <SettingsSection title="Authentication">
              <SettingRowBoolean
                checked={settings.proxy.auth != null}
                title="Enable authentication"
                description="Send proxy credentials with proxied requests."
                onChange={(enabled) =>
                  patchProxy({ auth: enabled ? { user: "", password: "" } : null })
                }
              />

              {settings.proxy.auth != null && (
                <>
                  <SettingRowText
                    required
                    name="proxyUser"
                    title="User"
                    description="Username for proxy authentication."
                    value={settings.proxy.auth.user}
                    placeholder="myUser"
                    onChange={(user) =>
                      patchProxy({
                        auth: {
                          user,
                          password:
                            settings.proxy?.type === "enabled"
                              ? (settings.proxy.auth?.password ?? "")
                              : "",
                        },
                      })
                    }
                  />
                  <SettingRowText
                    name="proxyPassword"
                    title="Password"
                    description="Password for proxy authentication."
                    value={settings.proxy.auth.password}
                    placeholder="s3cretPassw0rd"
                    type="password"
                    onChange={(password) =>
                      patchProxy({
                        auth: {
                          user:
                            settings.proxy?.type === "enabled"
                              ? (settings.proxy.auth?.user ?? "")
                              : "",
                          password,
                        },
                      })
                    }
                  />
                </>
              )}
            </SettingsSection>
          </>
        )}
      </SettingsList>
    </VStack>
  );
}

type EnabledProxySetting = Extract<ProxySetting, { type: "enabled" }>;

function enabledProxyOrDefault(proxy: ProxySetting | null): EnabledProxySetting {
  if (proxy?.type === "enabled") return proxy;

  return {
    disabled: false,
    type: "enabled",
    http: "",
    https: "",
    auth: { user: "", password: "" },
    bypass: "",
  };
}
