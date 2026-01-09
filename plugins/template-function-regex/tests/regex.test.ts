import type { Context } from '@yaakapp/api';
import { describe, expect, it } from 'vitest';
import { plugin } from '../src';

describe('regex.match', () => {
  const matchFunction = plugin.templateFunctions?.find((f) => f.name === 'regex.match');

  it('should exist', () => {
    expect(matchFunction).toBeDefined();
  });

  it('should extract first capture group', async () => {
    const result = await matchFunction?.onRender({} as Context, {
      values: {
        regex: 'Hello (\\w+)',
        input: 'Hello World',
      },
      purpose: 'send',
    });
    expect(result).toBe('World');
  });

  it('should extract named capture group', async () => {
    const result = await matchFunction?.onRender({} as Context, {
      values: {
        regex: 'Hello (?<name>\\w+)',
        input: 'Hello World',
      },
      purpose: 'send',
    });
    expect(result).toBe('World');
  });

  it('should return full match when no capture groups', async () => {
    const result = await matchFunction?.onRender({} as Context, {
      values: {
        regex: 'Hello \\w+',
        input: 'Hello World',
      },
      purpose: 'send',
    });
    expect(result).toBe('Hello World');
  });

  it('should return empty string when no match', async () => {
    const result = await matchFunction?.onRender({} as Context, {
      values: {
        regex: 'Goodbye',
        input: 'Hello World',
      },
      purpose: 'send',
    });
    expect(result).toBe('');
  });

  it('should return empty string when regex is empty', async () => {
    const result = await matchFunction?.onRender({} as Context, {
      values: {
        regex: '',
        input: 'Hello World',
      },
      purpose: 'send',
    });
    expect(result).toBe('');
  });

  it('should return empty string when input is empty', async () => {
    const result = await matchFunction?.onRender({} as Context, {
      values: {
        regex: 'Hello',
        input: '',
      },
      purpose: 'send',
    });
    expect(result).toBe('');
  });
});

describe('regex.replace', () => {
  const replaceFunction = plugin.templateFunctions?.find((f) => f.name === 'regex.replace');

  it('should exist', () => {
    expect(replaceFunction).toBeDefined();
  });

  it('should replace one occurrence by default', async () => {
    const result = await replaceFunction?.onRender({} as Context, {
      values: {
        regex: 'o',
        input: 'Hello World',
        replacement: 'a',
      },
      purpose: 'send',
    });
    expect(result).toBe('Hella World');
  });

  it('should replace with capture groups', async () => {
    const result = await replaceFunction?.onRender({} as Context, {
      values: {
        regex: '(\\w+) (\\w+)',
        input: 'Hello World',
        replacement: '$2 $1',
      },
      purpose: 'send',
    });
    expect(result).toBe('World Hello');
  });

  it('should replace with full match reference', async () => {
    const result = await replaceFunction?.onRender({} as Context, {
      values: {
        regex: 'World',
        input: 'Hello World',
        replacement: '[$&]',
      },
      purpose: 'send',
    });
    expect(result).toBe('Hello [World]');
  });

  it('should respect flags parameter', async () => {
    const result = await replaceFunction?.onRender({} as Context, {
      values: {
        regex: 'hello',
        input: 'Hello World',
        replacement: 'Hi',
        flags: 'i',
      },
      purpose: 'send',
    });
    expect(result).toBe('Hi World');
  });

  it('should handle empty replacement', async () => {
    const result = await replaceFunction?.onRender({} as Context, {
      values: {
        regex: 'World',
        input: 'Hello World',
        replacement: '',
      },
      purpose: 'send',
    });
    expect(result).toBe('Hello ');
  });

  it('should return original input when no match', async () => {
    const result = await replaceFunction?.onRender({} as Context, {
      values: {
        regex: 'Goodbye',
        input: 'Hello World',
        replacement: 'Hi',
      },
      purpose: 'send',
    });
    expect(result).toBe('Hello World');
  });

  it('should return empty string when regex is empty', async () => {
    const result = await replaceFunction?.onRender({} as Context, {
      values: {
        regex: '',
        input: 'Hello World',
        replacement: 'Hi',
      },
      purpose: 'send',
    });
    expect(result).toBe('');
  });

  it('should return empty string when input is empty', async () => {
    const result = await replaceFunction?.onRender({} as Context, {
      values: {
        regex: 'Hello',
        input: '',
        replacement: 'Hi',
      },
      purpose: 'send',
    });
    expect(result).toBe('');
  });

  it('should throw on invalid regex', async () => {
    const fn = replaceFunction?.onRender({} as Context, {
      values: {
        regex: '[',
        input: 'Hello World',
        replacement: 'Hi',
      },
      purpose: 'send',
    });
    await expect(fn).rejects.toThrow(
      'Invalid regular expression: /[/: Unterminated character class',
    );
  });
});
