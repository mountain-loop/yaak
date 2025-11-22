import type {
  Context,
  Environment,
  PartialImportResources,
  PluginDefinition,
  Workspace,
} from '@yaakapp/api';
import type { ImportPluginResponse } from '@yaakapp/api/lib/plugins/ImporterPlugin';

type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>;

interface ExportResources {
  workspaces: AtLeast<Workspace, 'name' | 'id' | 'model'>[];
  environments: AtLeast<Environment, 'name' | 'id' | 'model' | 'workspaceId'>[];
}

export const plugin: PluginDefinition = {
  importer: {
    name: 'Postman Environment',
    description: 'Import postman environment exports',
    onImport(_ctx: Context, args: { text: string }) {
      return convertPostmanEnvironment(args.text);
    },
  },
};

export function convertPostmanEnvironment(contents: string): ImportPluginResponse | undefined {
  const root = parseJSONToRecord(contents);
  if (root == null) return;

  // Validate that it looks like a Postman Environment export
  const values = toArray<{
    key?: string;
    value?: unknown;
    enabled?: boolean;
    description?: string;
    type?: string;
  }>(root.values);
  const scope = root._postman_variable_scope;
  const hasEnvMarkers = typeof scope === 'string';

  if (values.length === 0 || (!hasEnvMarkers && typeof root.name !== 'string')) {
    // Not a Postman environment file, skip
    return;
  }

  const exportResources: ExportResources = {
    workspaces: [],
    environments: [],
  };

  const envVariables = values
    .map((v) => ({
      enabled: v.enabled ?? true,
      name: String(v.key ?? ''),
      value: String(v.value),
      description: v.description ? String(v.description) : null,
    }))
    .filter((v) => v.name.length > 0);

  const environment: ExportResources['environments'][0] = {
    model: 'environment',
    id: generateId('environment'),
    name: root.name ? String(root.name) : 'Environment',
    workspaceId: 'CURRENT_WORKSPACE',
    parentModel: 'environment',
    parentId: null,
    variables: envVariables,
  };
  exportResources.environments.push(environment);

  const resources = deleteUndefinedAttrs(
    convertTemplateSyntax(exportResources),
  ) as PartialImportResources;

  return { resources };
}

function parseJSONToRecord<T>(jsonStr: string): Record<string, T> | null {
  try {
    return toRecord(JSON.parse(jsonStr));
  } catch {
    return null;
  }
}

function toRecord<T>(value: Record<string, T> | unknown): Record<string, T> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, T>;
  }
  return {} as Record<string, T>;
}

function toArray<T>(value: unknown): T[] {
  if (Object.prototype.toString.call(value) === '[object Array]') return value as T[];
  return [] as T[];
}

/** Recursively render all nested object properties */
function convertTemplateSyntax<T>(obj: T): T {
  if (typeof obj === 'string') {
    return obj.replace(/{{\s*(_\.)?([^}]*)\s*}}/g, (_m, _dot, expr) => `\${[${expr.trim()}]}`) as T;
  }
  if (Array.isArray(obj) && obj != null) {
    return obj.map(convertTemplateSyntax) as T;
  }
  if (typeof obj === 'object' && obj != null) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, convertTemplateSyntax(v)]),
    ) as T;
  }
  return obj;
}

function deleteUndefinedAttrs<T>(obj: T): T {
  if (Array.isArray(obj) && obj != null) {
    return obj.map(deleteUndefinedAttrs) as T;
  }
  if (typeof obj === 'object' && obj != null) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, deleteUndefinedAttrs(v)]),
    ) as T;
  }
  return obj;
}

const idCount: Partial<Record<string, number>> = {};

function generateId(model: string): string {
  idCount[model] = (idCount[model] ?? -1) + 1;
  return `GENERATE_ID::${model.toUpperCase()}_${idCount[model]}`;
}

export default plugin;
