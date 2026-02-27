import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { convertOpenApi } from '../src';

describe('importer-openapi', () => {
  const p = path.join(__dirname, 'fixtures');
  const fixtures = fs.readdirSync(p);

  test('Maps operation description to request description', async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Description Test', version: '1.0.0' },
        paths: {
          '/klanten': {
            get: {
              description: 'Lijst van klanten',
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({
        description: 'Lijst van klanten',
      }),
    ]);
  });

  test('Skips invalid file', async () => {
    const imported = await convertOpenApi('{}');
    expect(imported).toBeUndefined();
  });

  for (const fixture of fixtures) {
    test(`Imports ${fixture}`, async () => {
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
