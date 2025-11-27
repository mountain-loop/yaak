import crypto from 'node:crypto';
import type { Client } from '@1password/sdk';
import { createClient } from '@1password/sdk';
import type { PluginDefinition } from '@yaakapp/api';
import type { CallTemplateFunctionArgs } from '@yaakapp-internal/plugins';

const _clients: Record<string, Client> = {};

async function op(args: CallTemplateFunctionArgs): Promise<Client | null> {
  const token = args.values.token;
  if (typeof token !== 'string') return null;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    _clients[tokenHash] ??= await createClient({
      auth: token,
      integrationName: 'Yaak 1Password Plugin',
      integrationVersion: 'v1.0.0',
    });
  } catch {
    return null;
  }
  return _clients[tokenHash];
}

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: '1password.item',
      description: 'Get a secret',
      previewArgs: ['field'],
      args: [
        {
          name: 'token',
          type: 'text',
          label: '1Password Service Account Token',
          description:
            'Token can be generated from the 1Password website by visiting Developer > Service Accounts',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Yaak template syntax
          defaultValue: '${[1PASSWORD_TOKEN]}',
          password: true,
        },
        {
          name: 'vault',
          label: 'Vault',
          type: 'select',
          options: [],
          async dynamic(_ctx, args) {
            const client = await op(args);
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
            const client = await op(args);
            if (client == null) return { hidden: true };
            const vaultId = args.values.vault;
            if (typeof vaultId !== 'string') return { hidden: true };

            const items = await client.items.list(vaultId);
            return {
              options: items.map((item) => ({
                label: `${item.title} ${item.category}`,
                value: item.id,
              })),
            };
          },
        },
        {
          name: 'field',
          label: 'Field',
          type: 'select',
          options: [],
          async dynamic(_ctx, args) {
            const client = await op(args);
            if (client == null) return { hidden: true };
            const vaultId = args.values.vault;
            const itemId = args.values.item;
            if (typeof vaultId !== 'string' || typeof itemId !== 'string') {
              return { hidden: true };
            }

            const item = await client.items.get(vaultId, itemId);

            return {
              options: item.fields.map((field) => ({ label: field.title, value: field.id })),
            };
          },
        },
      ],
      async onRender(_ctx, args) {
        const client = await op(args);
        if (client == null) throw new Error('Invalid token');
        const vaultId = args.values.vault;
        const itemId = args.values.item;
        const fieldId = args.values.field;
        if (
          typeof vaultId !== 'string' ||
          typeof itemId !== 'string' ||
          typeof fieldId !== 'string'
        ) {
          return null;
        }

        const item = await client.items.get(vaultId, itemId);
        const field = item.fields.find((f) => f.id === fieldId);
        if (field == null) {
          throw new Error(`Field not found: ${fieldId}`);
        }
        return field.value ?? '';
      },
    },
  ],
};
