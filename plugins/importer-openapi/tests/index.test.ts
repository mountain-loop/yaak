import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { convertOpenApi } from '../src';

describe('importer-openapi', () => {
  const p = path.join(__dirname, 'fixtures');
  const fixtures = fs.readdirSync(p);

  test('Skips invalid file', async () => {
    const imported = await convertOpenApi('{}');
    expect(imported).toBeUndefined();
  });

  for (const fixture of fixtures) {
    test('Imports ' + fixture, async () => {
      const contents = fs.readFileSync(path.join(p, fixture), 'utf-8');
      const imported = await convertOpenApi(contents);
      expect(imported?.resources.workspaces).toEqual([
        expect.objectContaining({
          name: 'Swagger Petstore - OpenAPI 3.0',
          description: expect.stringContaining('This is a sample Pet Store Server'),
        }),
      ]);
      expect(imported?.resources.httpRequests.length).toBe(19);
      expect(imported?.resources.folders.length).toBe(7);
    });
  }
});
