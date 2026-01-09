import type { PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  authentication: {
    name: 'apikey',
    label: 'API Key',
    shortLabel: 'API Key',
    args: [
      {
        type: 'select',
        name: 'location',
        label: 'Behavior',
        defaultValue: 'header',
        options: [
          { label: 'Insert Header', value: 'header' },
          { label: 'Append Query Parameter', value: 'query' },
        ],
      },
      {
        type: 'text',
        name: 'key',
        label: 'Key',
        dynamic: (_ctx, { values }) => {
          return values.location === 'query'
            ? {
                label: 'Parameter Name',
                description: 'The name of the query parameter to add to the request',
              }
            : {
                label: 'Header Name',
                description: 'The name of the header to add to the request',
              };
        },
      },
      {
        type: 'text',
        name: 'value',
        label: 'API Key',
        optional: true,
        password: true,
      },
    ],
    async onApply(_ctx, { values }) {
      const key = String(values.key ?? '');
      const value = String(values.value ?? '');
      const location = String(values.location);

      if (location === 'query') {
        return { setQueryParameters: [{ name: key, value }] };
      }
      return { setHeaders: [{ name: key, value }] };
    },
  },
};
