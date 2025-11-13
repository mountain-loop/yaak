import type { TemplateFunctionPlugin } from '@yaakapp/api';

export function migrateTemplateFunctionSelectOptions(
  f: TemplateFunctionPlugin,
): TemplateFunctionPlugin {
  const migratedArgs = f.args.map((a) => {
    if (a.type === 'select') {
      a.options = a.options.map((o) => ({
        ...o,
        label: o.label || (o as any).name,
      }));
    }
    return a;
  });

  return { ...f, args: migratedArgs };
}
