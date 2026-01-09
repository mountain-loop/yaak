import type { PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'ctx.request',
      description: 'Get the ID of the currently active request',
      args: [],
      async onRender(ctx) {
        return ctx.window.requestId();
      },
    },
    {
      name: 'ctx.environment',
      description: 'Get the ID of the currently active environment',
      args: [],
      async onRender(ctx) {
        return ctx.window.environmentId();
      },
    },
    {
      name: 'ctx.workspace',
      description: 'Get the ID of the currently active workspace',
      args: [],
      async onRender(ctx) {
        return ctx.window.workspaceId();
      },
    },
  ],
};
