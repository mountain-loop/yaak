import crypto from 'node:crypto';
import type { Client } from '@1password/sdk';
import { createClient, DesktopAuth } from '@1password/sdk';
import type { JsonPrimitive, PluginDefinition } from '@yaakapp/api';
import type { CallTemplateFunctionArgs } from '@yaakapp-internal/plugins';

const _clients: Record<string, Client> = {};

// Cache for API responses to avoid rate limiting
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

type Result<T> = { error: unknown } | T;

const CACHE_TTL_MS = 60 * 1000; // 1 minute cache TTL
const _cache: Record<string, CacheEntry<unknown>> = {};

async function op(
  args: CallTemplateFunctionArgs,
): Promise<Result<{ client: Client; clientHash: string }>> {
  let authMethod: string | DesktopAuth;
  let hash: string;
  switch (args.values.authMethod) {
    case 'desktop': {
      const account = args.values.token;
      if (typeof account !== 'string' || !account) return { error: 'Missing account name' };

      hash = crypto.createHash('sha256').update(`desktop:${account}`).digest('hex');
      authMethod = new DesktopAuth(account);
      break;
    }
    case 'token': {
      const token = args.values.token;
      if (typeof token !== 'string' || !token) return { error: 'Missing service token' };

      hash = crypto.createHash('sha256').update(`token:${token}`).digest('hex');
      authMethod = token;
      break;
    }
    default:
      return { error: 'Invalid authentication method' };
  }

  let client: Client;
  try {
    client = await createClient({
      auth: authMethod,
      integrationName: 'Yaak 1Password Plugin',
      integrationVersion: 'v1.0.0',
    });
    _clients[hash] = client;
  } catch (e) {
    return { error: e };
  }

  return { client, clientHash: hash };
}

async function getValue(
  args: CallTemplateFunctionArgs,
  vaultId?: JsonPrimitive,
  itemId?: JsonPrimitive,
  fieldId?: JsonPrimitive,
): Promise<Result<{ value: string }>> {
  const res = await op(args);
  if ('error' in res) return { error: res.error };
  const clientHash = res.clientHash;
  const client = res.client;

  if (!vaultId || typeof vaultId !== 'string') {
    return { error: 'No vault specified' };
  }
  if (!itemId || typeof itemId !== 'string') {
    return { error: 'No item specified' };
  }
  if (!fieldId || typeof fieldId !== 'string') {
    return { error: 'No field specified' };
  }

  try {
    const cacheKey = `${clientHash}:item:${vaultId}:${itemId}:${fieldId}`;
    let value = getCached<string>(cacheKey);

    if (!value) {
      value = await client.secrets.resolve(`op://${vaultId}/${itemId}/${fieldId}`);
      setCache(cacheKey, value);
    }

    return { value };
  } catch (e) {
    return { error: e };
  }
}

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: '1password.item',
      description: 'Get a secret',
      previewArgs: ['field'],
      args: [
        {
          type: 'h_stack',
          inputs: [
            {
              name: 'authMethod',
              type: 'select',
              label: 'Authentication Method',
              defaultValue: 'token',
              options: [
                {
                  label: 'Service Account',
                  value: 'token',
                },
                {
                  label: 'Desktop App',
                  value: 'desktop',
                },
              ],
            },
            {
              name: 'token',
              type: 'text',
              // biome-ignore lint/suspicious/noTemplateCurlyInString: Yaak template syntax
              defaultValue: '${[1PASSWORD_TOKEN]}',
              dynamic(_ctx, args) {
                switch (args.values.authMethod) {
                  case 'desktop':
                    return {
                      label: 'Account Name',
                      description:
                        'Account name can be taken from the sidebar of the 1Password App. Make sure you\'re on the BETA version of the 1Password app and have "Integrate with other apps" enabled in Settings > Developer.',
                    };
                  case 'token':
                    return {
                      label: 'Token',
                      description:
                        'Token can be generated from the 1Password website by visiting Developer > Service Accounts',
                      password: true,
                    };
                }

                return { hidden: true };
              },
            },
          ],
        },
        {
          name: 'vault',
          label: 'Vault',
          type: 'select',
          options: [],
          async dynamic(_ctx, args) {
            const res = await op(args);
            if ('error' in res) return { hidden: true };
            const clientHash = res.clientHash;
            const client = res.client;

            const cacheKey = `${clientHash}:vaults`;
            const cachedVaults =
              getCached<Awaited<ReturnType<typeof client.vaults.list>>>(cacheKey);
            const vaults =
              cachedVaults ??
              setCache(cacheKey, await client.vaults.list({ decryptDetails: true }));

            return {
              options: vaults.map((vault) => {
                let title = vault.id;
                if ('title' in vault) {
                  title = vault.title;
                } else if ('name' in vault) {
                  // The SDK returns 'name' instead of 'title' but the bindings still use 'title'
                  title = (vault as { name: string }).name;
                }

                return {
                  label: `${title} (${vault.activeItemCount} Items)`,
                  value: vault.id,
                };
              }),
            };
          },
        },
        {
          name: 'item',
          label: 'Item',
          type: 'select',
          options: [],
          async dynamic(_ctx, args) {
            const res = await op(args);
            if ('error' in res) return { hidden: true };
            const clientHash = res.clientHash;
            const client = res.client;

            const vaultId = args.values.vault;
            if (typeof vaultId !== 'string') return { hidden: true };

            try {
              const cacheKey = `${clientHash}:items:${vaultId}`;
              const cachedItems =
                getCached<Awaited<ReturnType<typeof client.items.list>>>(cacheKey);
              const items = cachedItems ?? setCache(cacheKey, await client.items.list(vaultId));
              return {
                options: items.map((item) => ({
                  label: `${item.title} ${item.category}`,
                  value: item.id,
                })),
              };
            } catch {
              // Hide as we can't list the items for this vault
              return { hidden: true };
            }
          },
        },
        {
          name: 'field',
          label: 'Field',
          type: 'select',
          options: [],
          async dynamic(_ctx, args) {
            const res = await op(args);
            if ('error' in res) return { hidden: true };
            const clientHash = res.clientHash;
            const client = res.client;

            const vaultId = args.values.vault;
            const itemId = args.values.item;
            if (typeof vaultId !== 'string' || typeof itemId !== 'string') {
              return { hidden: true };
            }

            try {
              const cacheKey = `${clientHash}:item:${vaultId}:${itemId}`;
              const cachedItem = getCached<Awaited<ReturnType<typeof client.items.get>>>(cacheKey);
              const item =
                cachedItem ?? setCache(cacheKey, await client.items.get(vaultId, itemId));
              return {
                options: item.fields.map((field) => ({ label: field.title, value: field.id })),
              };
            } catch {
              // Hide as we can't find the item within this vault
              return { hidden: true };
            }
          },
        },
      ],
      async onRender(_ctx, args) {
        const vaultId = args.values.vault;
        const itemId = args.values.item;
        const fieldId = args.values.field;
        const res = await getValue(args, vaultId, itemId, fieldId);
        if ('error' in res) {
          throw res.error;
        }

        return res.value;
      },
    },
  ],
};

function getCached<T>(key: string): T | undefined {
  const entry = _cache[key];
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  // Clean up expired entry
  if (entry) {
    delete _cache[key];
  }
  return undefined;
}

function setCache<T>(key: string, data: T): T {
  _cache[key] = {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return data;
}
