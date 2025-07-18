import type { CallHttpAuthenticationRequest } from '@yaakapp-internal/plugins';
import type { PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  authentication: {
    name: 'bearer',
    label: 'Bearer Token',
    shortLabel: 'Bearer',
    args: [
      {
        type: 'text',
        name: 'token',
        label: 'Token',
        optional: true,
        password: true,
      },
      {
        type: 'text',
        name: 'prefix',
        label: 'Prefix',
        optional: true,
        placeholder: '',
        defaultValue: 'Bearer',
        description:
          'The prefix to use for the Authorization header, which will be of the format "<PREFIX> <TOKEN>".',
      },
    ],
    async onApply(_ctx, { values }) {
      return { setHeaders: [generateAuthorizationHeader(values)] };
    },
  },
};

function generateAuthorizationHeader(values: CallHttpAuthenticationRequest['values']) {
  const token = String(values.token || '').trim();
  const prefix = String(values.prefix || '').trim();
  const value = `${prefix} ${token}`.trim();
  return { name: 'Authorization', value };
}
