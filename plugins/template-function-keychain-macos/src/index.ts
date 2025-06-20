import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import keychain from 'keychain';

export const plugin: PluginDefinition = {
  templateFunctions: [{
    name: 'keychain.getPassword',
    description: 'Retrieve a password from the macOS keychain',
    args: [
      { title: 'Service', type: 'text', name: 'service', label: 'Service', required: true },
      { title: 'Account', type: 'text', name: 'account', label: 'Account', required: true },
      {
        title: 'Type',
        type: 'select',
        name: 'type',
        label: 'Type',
        options: [
          { label: 'Generic', value: 'generic' },
          { label: 'Internet', value: 'internet' }
        ],
        defaultValue: 'generic'
      }
    ],
    async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
      if (!args.values.service || !args.values.account) return null;

      try {
        return new Promise((resolve, reject) => {
          keychain.getPassword({
            account: args.values.account,
            service: args.values.service,
            type: args.values.type || 'generic'
          }, (err, password) => {
            if (err) reject(err);
            else resolve(password);
          });
        });
      } catch (err) {
        return null;
      }
    },
  }],
};
