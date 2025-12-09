import crypto from 'node:crypto';
import type { Client } from '@1password/sdk';
import { createClient, DesktopAuth } from '@1password/sdk';
import type { JsonPrimitive, PluginDefinition } from '@yaakapp/api';
import type { CallTemplateFunctionArgs } from '@yaakapp-internal/plugins';

const _clients: Record<string, Client> = {};

async function op(args: CallTemplateFunctionArgs): Promise<{ client?: Client; error?: unknown }> {
  let authMethod: string | DesktopAuth | null = null;
  let hash: string | null = null;
  switch (args.values.auth_method) {
    case 'desktop': {
      const account = args.values.token;
      if (typeof account !== 'string') return { error: 'Missing account name' };

      hash = crypto.createHash('sha256').update(`desktop:${account}`).digest('hex');
      authMethod = new DesktopAuth(account);
      break;
    }
    case 'token': {
      const token = args.values.token;
      if (typeof token !== 'string') return { error: 'Missing service token' };

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

  return { client: _clients[hash] };
}

async function getValue(
  args: CallTemplateFunctionArgs,
  vaultId?: JsonPrimitive,
  itemId?: JsonPrimitive,
  fieldId?: JsonPrimitive,
): Promise<{ value?: string; error?: unknown }> {
  const { client, error } = await op(args);
  if (!client) return { error };

  if (vaultId && typeof vaultId === 'string') {
    try {
      await client.vaults.getOverview(vaultId);
    } catch {
      return { error: `Vault ${vaultId} not found` };
    }
  } else {
    return { error: 'No vault specified' };
  }

  if (itemId && typeof itemId === 'string') {
    try {
      const item = await client.items.get(vaultId, itemId);
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
          name: 'auth_method',
          type: 'select',
          label: 'Authentication Method',
          options: [
            {
              label: '1Password Service Account Token',
              value: 'token',
            },
            {
              label: '1Password Desktop App',
              value: 'desktop',
            },
          ],
          defaultValue: 'token',
        },
        {
          name: 'token',
          type: 'text',
          description: '',
          dynamic(_ctx, args) {
            switch (args.values.auth_method) {
              case 'desktop':
                return {
                  name: 'token',
                  type: 'text',
                  label: '1Password Account Name',
                  description:
                    'Account name can be taken from the sidebar of the 1Password App. Make sure you\'re on the BETA version of the 1Password app and have "Integrate with other apps" enabled in Settings > Developer.',
                };
              case 'token':
                return {
                  name: 'token',
                  type: 'text',
                  label: '1Password Service Account Token',
                  description:
                    'Token can be generated from the 1Password website by visiting Developer > Service Accounts',
                  // biome-ignore lint/suspicious/noTemplateCurlyInString: Yaak template syntax
                  defaultValue: '${[1PASSWORD_TOKEN]}',
                  password: true,
                };
            }

            return { hidden: true };
          },
        },
        {
          name: 'vault',
          label: 'Vault',
          type: 'select',
          options: [],
          async dynamic(_ctx, args) {
            const { client } = await op(args);
            if (client == null) return { hidden: true };
            // Fetches a secret.
            const vaults = await client.vaults.list({ decryptDetails: true });
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
            const { client } = await op(args);
            if (client == null) return { hidden: true };
            const vaultId = args.values.vault;
            if (typeof vaultId !== 'string') return { hidden: true };

            try {
              const items = await client.items.list(vaultId);
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
            const { client } = await op(args);
            if (client == null) return { hidden: true };
            const vaultId = args.values.vault;
            const itemId = args.values.item;
            if (typeof vaultId !== 'string' || typeof itemId !== 'string') {
              return { hidden: true };
            }

            try {
              const item = await client.items.get(vaultId, itemId);
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
