import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { convertPostman } from '../src';

describe('importer-postman', () => {
  const p = path.join(__dirname, 'fixtures');
  const fixtures = fs.readdirSync(p);

  for (const fixture of fixtures) {
    if (fixture.includes('.output')) {
      continue;
    }

    test('Imports ' + fixture, () => {
      const contents = fs.readFileSync(path.join(p, fixture), 'utf-8');
      const expected = fs.readFileSync(path.join(p, fixture.replace('.input', '.output')), 'utf-8');
      const result = convertPostman(contents);
      // console.log(JSON.stringify(result, null, 2))
      expect(result).toEqual(JSON.parse(expected));
    });
  }
});
