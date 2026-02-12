import { describe, expect, it } from 'vitest';

describe('template-function-faker', () => {
  it('exports all expected template functions', async () => {
    const { plugin } = await import('../src/index');
    const names = plugin.templateFunctions?.map((fn) => fn.name).sort() ?? [];

    // Snapshot the full list of exported function names so we catch any
    // accidental additions, removals, or renames across faker upgrades.
    expect(names).toMatchSnapshot();
  });
});
