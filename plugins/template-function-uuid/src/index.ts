import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import { v1, v3, v4, v5, v6, v7 } from 'uuid';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'uuid.v1',
      description: 'Generate a UUID V1',
      args: [],
      async onRender(_ctx: Context, _args: CallTemplateFunctionArgs): Promise<string | null> {
        return v1();
      },
    },
    {
      name: 'uuid.v3',
      description: 'Generate a UUID V3',
      args: [
        { type: 'text', name: 'name', label: 'Name' },
        {
          type: 'text',
          name: 'namespace',
          label: 'Namespace UUID',
          description: 'A valid UUID to use as the namespace',
          placeholder: '24ced880-3bf4-11f0-8329-cd053d577f0e',
        },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        return v3(String(args.values.name), String(args.values.namespace));
      },
    },
    {
      name: 'uuid.v4',
      description: 'Generate a UUID V4',
      args: [],
      async onRender(_ctx: Context, _args: CallTemplateFunctionArgs): Promise<string | null> {
        return v4();
      },
    },
    {
      name: 'uuid.v5',
      description: 'Generate a UUID V5',
      args: [
        { type: 'text', name: 'name', label: 'Name' },
        { type: 'text', name: 'namespace', label: 'Namespace' },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        return v5(String(args.values.name), String(args.values.namespace));
      },
    },
    {
      name: 'uuid.v6',
      description: 'Generate a UUID V6',
      args: [
        {
          type: 'text',
          name: 'timestamp',
          label: 'Timestamp',
          optional: true,
          description: 'Can be any format that can be parsed by JavaScript new Date(...)',
          placeholder: '2025-05-28T11:15:00Z',
        },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        return v6({ msecs: new Date(String(args.values.timestamp)).getTime() });
      },
    },
    {
      name: 'uuid.v7',
      description: 'Generate a UUID V7',
      args: [],
      async onRender(_ctx: Context, _args: CallTemplateFunctionArgs): Promise<string | null> {
        return v7();
      },
    },
  ],
};
