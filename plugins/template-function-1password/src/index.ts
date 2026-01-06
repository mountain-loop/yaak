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

const CACHE_TTL_MS = 60 * 1000; // 1 minute cache TTL
const _cache: Record<string, CacheEntry<unknown>> = {};

async function op(
  args: CallTemplateFunctionArgs,
): Promise<{ client?: Client; clientHash?: string; error?: unknown }> {
  let authMethod: string | DesktopAuth | null = null;
  let hash: string | null = null;
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
  }

  if (hash == null || authMethod == null) return { error: 'Invalid authentication method' };

  try {
    _clients[hash] ??= await createClient({
      auth: authMethod,
      integrationName: 'Yaak 1Password Plugin',
      integrationVersion: 'v1.0.0',
    });
  } catch (e) {
    return { error: e };
  }

  return { client: _clients[hash], clientHash: hash };
}

async function getValue(
  args: CallTemplateFunctionArgs,
  vaultId?: JsonPrimitive,
  itemId?: JsonPrimitive,
  fieldId?: JsonPrimitive,
): Promise<{ value?: string; error?: unknown }> {
  const { client, error, clientHash } = await op(args);
  if (!client || !clientHash) return { error };

  if (vaultId && typeof vaultId === 'string') {
    const vaultCacheKey = `${clientHash}:vault:${vaultId}`;
    const cachedVault = getCached(vaultCacheKey);
    if (!cachedVault) {
      try {
        const vault = await client.vaults.getOverview(vaultId);
        setCache(vaultCacheKey, vault);
      } catch {
        return { error: `Vault ${vaultId} not found` };
      }
    }
  } else {
    return { error: 'No vault specified' };
  }

  if (itemId && typeof itemId === 'string') {
    const itemCacheKey = `${clientHash}:item:${vaultId}:${itemId}`;
    try {
      const item =
        getCached<Awaited<ReturnType<typeof client.items.get>>>(itemCacheKey) ??
        setCache(itemCacheKey, await client.items.get(vaultId, itemId));
      if (fieldId && typeof fieldId === 'string') {
        const field = item.fields.find((f) => f.id === fieldId);
        if (field) {
          return { value: field.value };
        } else {
          return { error: `Field ${fieldId} not found in item ${itemId} in vault ${vaultId}` };
        }
      }
    } catch {
      return { error: `Item ${itemId} not found in vault ${vaultId}` };
    }
  } else {
    return { error: 'No item specified' };
  }

  return {};
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
            const { client, clientHash } = await op(args);
            if (client == null || clientHash == null) return { hidden: true };

            const cacheKey = `${clientHash}:vaults`;
            const cachedVaults =
              getCached<Awaited<ReturnType<typeof client.vaults.list>>>(cacheKey);
            const vaults =
              cachedVaults ??
              setCache(cacheKey, await client.vaults.list({ decryptDetails: true }));
            return {
              options: vaults.map((vault) => ({
                label: `${vault.title} (${vault.activeItemCount} Items)`,
                value: vault.id,
              })),
            };
          },
        },
        {
          name: 'item',
          label: 'Item',
          type: 'select',
          options: [],
          async dynamic(_ctx, args) {
            const { client, clientHash } = await op(args);
            if (client == null || clientHash == null) return { hidden: true };
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
            const { client, clientHash } = await op(args);
            if (client == null || clientHash == null) return { hidden: true };
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
        const { value, error } = await getValue(args, vaultId, itemId, fieldId);
        if (error) {
          throw error;
        }

        return value ?? '';
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
