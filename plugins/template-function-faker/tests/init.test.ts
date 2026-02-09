import { describe, expect, it } from 'vitest';

describe('formatDatetime', () => {
  it('returns formatted current date', async () => {
    // Ensure the plugin imports properly
    const faker = await import('../src/index');
    expect(faker.plugin.templateFunctions?.length).toBe(226);
  });
});
