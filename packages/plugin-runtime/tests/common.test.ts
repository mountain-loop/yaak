import { applyFormInputDefaults } from '@yaakapp-internal/lib/templateFunction';
import type { CallTemplateFunctionArgs } from '@yaakapp-internal/plugins';
import type { Context, DynamicTemplateFunctionArg } from '@yaakapp/api';
import { describe, expect, test } from 'vitest';
import { applyDynamicFormInput } from '../src/common';

describe('applyFormInputDefaults', () => {
  test('Works with top-level select', () => {
    const args: DynamicTemplateFunctionArg[] = [
      {
        type: 'select',
        name: 'test',
        options: [{ label: 'Option 1', value: 'one' }],
        defaultValue: 'one',
      },
    ];
    expect(applyFormInputDefaults(args, {})).toEqual({
      test: 'one',
    });
  });

  test('Works with existing value', () => {
    const args: DynamicTemplateFunctionArg[] = [
      {
        type: 'select',
        name: 'test',
        options: [{ label: 'Option 1', value: 'one' }],
        defaultValue: 'one',
      },
    ];
    expect(applyFormInputDefaults(args, { test: 'explicit' })).toEqual({
      test: 'explicit',
    });
  });

  test('Works with recursive select', () => {
    const args: DynamicTemplateFunctionArg[] = [
      { type: 'text', name: 'dummy', defaultValue: 'top' },
      {
        type: 'accordion',
        label: 'Test',
        inputs: [
          { type: 'text', name: 'name', defaultValue: 'hello' },
          {
            type: 'select',
            name: 'test',
            options: [{ label: 'Option 1', value: 'one' }],
            defaultValue: 'one',
          },
        ],
      },
    ];
    expect(applyFormInputDefaults(args, {})).toEqual({
      dummy: 'top',
      test: 'one',
      name: 'hello',
    });
  });

  test('Works with dynamic options', () => {
    const args: DynamicTemplateFunctionArg[] = [
      {
        type: 'select',
        name: 'test',
        defaultValue: 'one',
        options: [],
        dynamic() {
          return { options: [{ label: 'Option 1', value: 'one' }] };
        },
      },
    ];
    expect(applyFormInputDefaults(args, {})).toEqual({
      test: 'one',
    });
    expect(applyFormInputDefaults(args, {})).toEqual({
      test: 'one',
    });
  });
});

describe('applyDynamicFormInput', () => {
  test('Works with plain input', async () => {
    const ctx = {} as Context;
    const args: DynamicTemplateFunctionArg[] = [
      { type: 'text', name: 'name' },
      { type: 'checkbox', name: 'checked' },
    ];
    const callArgs: CallTemplateFunctionArgs = {
      values: {},
      purpose: 'preview',
    };
    expect(await applyDynamicFormInput(ctx, args, callArgs)).toEqual([
      { type: 'text', name: 'name' },
      { type: 'checkbox', name: 'checked' },
    ]);
  });

  test('Works with dynamic input', async () => {
    const ctx = {} as Context;
    const args: DynamicTemplateFunctionArg[] = [
      {
        type: 'text',
        name: 'name',
        async dynamic(_ctx, _args) {
          return { hidden: true };
        },
      },
    ];
    const callArgs: CallTemplateFunctionArgs = {
      values: {},
      purpose: 'preview',
    };
    expect(await applyDynamicFormInput(ctx, args, callArgs)).toEqual([
      { type: 'text', name: 'name', hidden: true },
    ]);
  });

  test('Works with recursive dynamic input', async () => {
    const ctx = {} as Context;
    const callArgs: CallTemplateFunctionArgs = {
      values: { hello: 'world' },
      purpose: 'preview',
    };
    const args: DynamicTemplateFunctionArg[] = [
      {
        type: 'banner',
        inputs: [
          {
            type: 'text',
            name: 'name',
            async dynamic(_ctx, args) {
              return { hidden: args.values.hello === 'world' };
            },
          },
        ],
      },
    ];
    expect(await applyDynamicFormInput(ctx, args, callArgs)).toEqual([
      {
        type: 'banner',
        inputs: [
          {
            type: 'text',
            name: 'name',
            hidden: true,
          },
        ],
      },
    ]);
  });
});
