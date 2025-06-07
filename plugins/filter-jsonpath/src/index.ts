import { PluginDefinition } from '@yaakapp/api';
import { JSONPath } from 'jsonpath-plus';

export const plugin: PluginDefinition = {
  filter: {
    name: 'JSONPath',
    description: 'Filter JSONPath',
    onFilter(_ctx, args) {
      const parsed = JSON.parse(args.payload);
      const filtered = JSONPath({ path: args.filter, json: parsed });
      return { filtered: JSON.stringify(filtered, null, 2) };
    },
  },
};
