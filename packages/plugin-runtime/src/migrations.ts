import type { TemplateFunctionPlugin } from '@yaakapp/api';

export function migrateTemplateFunctionSelectOptions(
  f: TemplateFunctionPlugin,
): TemplateFunctionPlugin {
  const migratedArgs = f.args.map((a) => {
    if (a.type === 'select') {
      // Migrate old options that had 'name' instead of 'label'
      type LegacyOption = { label?: string; value: string; name?: string };
      a.options = a.options.map((o) => {
        const legacy = o as LegacyOption;
        return {
          label: legacy.label ?? legacy.name ?? '',
          value: legacy.value,
        };
      });
    }
    return a;
  });

  return { ...f, args: migratedArgs };
}
