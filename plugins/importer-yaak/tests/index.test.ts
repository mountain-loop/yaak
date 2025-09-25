import { describe, expect, test } from 'vitest';
import { migrateImport } from '../src';

describe('importer-yaak', () => {
  test('Skips invalid imports', () => {
    expect(migrateImport('not JSON')).toBeUndefined();
    expect(migrateImport('[]')).toBeUndefined();
    expect(migrateImport(JSON.stringify({ resources: {} }))).toBeUndefined();
  });

  test('converts schema 1 to 2', () => {
    const imported = migrateImport(
      JSON.stringify({
        yaakSchema: 1,
        resources: {
          requests: [],
        },
      }),
    );

    expect(imported).toEqual(
      expect.objectContaining({
        resources: {
          httpRequests: [],
        },
      }),
    );
  });
  test('converts schema 2 to 3', () => {
    const imported = migrateImport(
      JSON.stringify({
        yaakSchema: 2,
        resources: {
          environments: [
            {
              id: 'e_1',
              workspaceId: 'w_1',
              name: 'Production',
              variables: [{ name: 'E1', value: 'E1!' }],
            },
          ],
          workspaces: [
            {
              id: 'w_1',
              variables: [{ name: 'W1', value: 'W1!' }],
            },
          ],
        },
      }),
    );

    expect(imported).toEqual(
      expect.objectContaining({
        resources: {
          workspaces: [
            {
              id: 'w_1',
            },
          ],
          environments: [
            {
              id: 'e_1',
              workspaceId: 'w_1',
              name: 'Production',
              variables: [{ name: 'E1', value: 'E1!' }],
              parentModel: 'environment',
              parentId: null,
            },
            {
              id: 'GENERATE_ID::base_env_w_1',
              workspaceId: 'w_1',
              name: 'Global Variables',
              variables: [{ name: 'W1', value: 'W1!' }],
            },
          ],
        },
      }),
    );
  });

  test('converts schema 4 to 5', () => {
    const imported = migrateImport(
      JSON.stringify({
        yaakSchema: 2,
        resources: {
          environments: [
            {
              id: 'e_1',
              workspaceId: 'w_1',
              base: false,
              name: 'Production',
              variables: [{ name: 'E1', value: 'E1!' }],
            },
            {
              id: 'e_1',
              workspaceId: 'w_1',
              base: true,
              name: 'Global Variables',
              variables: [{ name: 'G1', value: 'G1!' }],
            },
          ],
          folders: [
            {
              id: 'f_1',
            },
          ],
          workspaces: [
            {
              id: 'w_1',
            },
          ],
        },
      }),
    );

    expect(imported).toEqual(
      expect.objectContaining({
        resources: {
          workspaces: [
            {
              id: 'w_1',
            },
          ],
          folders: [
            {
              id: 'f_1',
            },
          ],
          environments: [
            {
              id: 'e_1',
              workspaceId: 'w_1',
              name: 'Production',
              variables: [{ name: 'E1', value: 'E1!' }],
              parentModel: 'environment',
              parentId: null,
            },
            {
              id: 'e_1',
              workspaceId: 'w_1',
              name: 'Global Variables',
              parentModel: 'workspace',
              parentId: null,
              variables: [{ name: 'G1', value: 'G1!' }],
            },
          ],
        },
      }),
    );
  });
});
