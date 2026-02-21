import { describe, expect, it } from 'vitest';

describe('template-function-faker', () => {
  it('exports all expected template functions', async () => {
    const { plugin } = await import('../src/index');
    const names = plugin.templateFunctions?.map((fn) => fn.name).sort() ?? [];

    // Snapshot the full list of exported function names so we catch any
    // accidental additions, removals, or renames across faker upgrades.
    expect(names).toMatchSnapshot();
  });

  it('renders date results as unquoted ISO strings', async () => {
    const { plugin } = await import('../src/index');
    const fn = plugin.templateFunctions?.find((fn) => fn.name === 'faker.date.future');

    expect(fn?.onRender).toBeTypeOf('function');

    const result = await fn!.onRender!(
      {} as Parameters<NonNullable<typeof fn.onRender>>[0],
      { values: {} } as Parameters<NonNullable<typeof fn.onRender>>[1],
    );

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
