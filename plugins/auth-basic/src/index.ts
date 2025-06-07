import { PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  authentication: {
    name: 'basic',
    label: 'Basic Auth',
    shortLabel: 'Basic',
    args: [{
      type: 'text',
      name: 'username',
      label: 'Username',
      optional: true,
    }, {
      type: 'text',
      name: 'password',
      label: 'Password',
      optional: true,
      password: true,
    }],
    async onApply(_ctx, { values }) {
      const { username, password } = values;
      const value = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      return { setHeaders: [{ name: 'Authorization', value }] };
    },
  },
};
