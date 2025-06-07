import { PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  authentication: {
    name: 'bearer',
    label: 'Bearer Token',
    shortLabel: 'Bearer',
    args: [{
      type: 'text',
      name: 'token',
      label: 'Token',
      optional: true,
      password: true,
    }],
    async onApply(_ctx, { values }) {
      const { token } = values;
      const value = `Bearer ${token}`.trim();
      return { setHeaders: [{ name: 'Authorization', value }] };
    },
  },
};
