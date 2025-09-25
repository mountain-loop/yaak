import type { Environment, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  importer: {
    name: 'Yaak',
    description: 'Yaak official format',
    onImport(_ctx, args) {
      return migrateImport(args.text);
    },
  },
};

export function migrateImport(contents: string) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return undefined;
  }

  if (!isJSObject(parsed)) {
    return undefined;
  }

  const isYaakExport = 'yaakSchema' in parsed;
  if (!isYaakExport) {
    return;
  }

  // Migrate v1 to v2 -- changes requests to httpRequests
  if ('requests' in parsed.resources) {
    parsed.resources.httpRequests = parsed.resources.requests;
    delete parsed.resources['requests'];
  }

  // Migrate v2 to v3
  for (const workspace of parsed.resources.workspaces ?? []) {
    if ('variables' in workspace) {
      // Create the base environment
      const baseEnvironment: Partial<Environment> = {
        id: `GENERATE_ID::base_env_${workspace['id']}`,
        name: 'Global Variables',
        variables: workspace.variables,
        workspaceId: workspace.id,
      };
      parsed.resources.environments = parsed.resources.environments ?? [];
      parsed.resources.environments.push(baseEnvironment);

      // Delete variables key from the workspace
      delete workspace.variables;

      // Add environmentId to relevant environments
      for (const environment of parsed.resources.environments) {
        if (environment.workspaceId === workspace.id && environment.id !== baseEnvironment.id) {
          environment.environmentId = baseEnvironment.id;
        }
      }
    }
  }

  // Migrate v3 to v4
  for (const environment of parsed.resources.environments ?? []) {
    if ('environmentId' in environment) {
      environment.base = environment.environmentId == null;
      delete environment.environmentId;
    }
  }

  // Migrate v4 to v5
  for (const environment of parsed.resources.environments ?? []) {
    if ('base' in environment && environment.base) {
      environment.parentModel = 'workspace';
      environment.parentId = null;
      delete environment.base;
    } else if ('base' in environment && !environment.base) {
      environment.parentModel = 'environment';
      environment.parentId = null;
      delete environment.base;
    }
  }

  return { resources: parsed.resources };
}

function isJSObject(obj: unknown) {
  return Object.prototype.toString.call(obj) === '[object Object]';
}
