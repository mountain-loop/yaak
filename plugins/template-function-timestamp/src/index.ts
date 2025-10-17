import type { TemplateFunctionArg } from '@yaakapp-internal/plugins';
import type { PluginDefinition } from '@yaakapp/api';

import type { ContextFn } from 'date-fns';
import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addSeconds,
  addYears,
  format as formatDate,
  isValid,
  parseISO,
  subDays,
  subHours,
  subMinutes,
  subMonths,
  subSeconds,
  subYears,
} from 'date-fns';

const dateArg: TemplateFunctionArg = {
  type: 'text',
  name: 'date',
  label: 'Timestamp',
  optional: true,
  description:
    'Can be a timestamp in milliseconds, ISO string, or anything parseable by JS `new Date()`',
  placeholder: new Date().toISOString(),
};

const expressionArg: TemplateFunctionArg = {
  type: 'text',
  name: 'expression',
  label: 'Expression',
  description: "Modification expression (eg. '-5d +2h 3m'). Available units: y, M, d, h, m, s",
  optional: true,
  placeholder: '-5d +2h 3m',
};

const formatArg: TemplateFunctionArg = {
  name: 'format',
  label: 'Format String',
  description: "Format string to describe the output (eg. 'yyyy-MM-dd at HH:mm:ss')",
  optional: true,
  placeholder: 'yyyy-MM-dd HH:mm:ss',
  type: 'text',
};

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'timestamp.unix',
      description: 'Get the current timestamp in seconds',
      args: [],
      onRender: async () => String(Math.floor(Date.now() / 1000)),
    },
    {
      name: 'timestamp.unixMillis',
      description: 'Get the current timestamp in milliseconds',
      args: [],
      onRender: async () => String(Date.now()),
    },
    {
      name: 'timestamp.iso8601',
      description: 'Get the current date in ISO8601 format',
      args: [],
      onRender: async () => new Date().toISOString(),
    },
    {
      name: 'timestamp.format',
      description: 'Format a date using a dayjs-compatible format string',
      args: [dateArg, formatArg],
      onRender: async (_ctx, args) => formatDatetime(args.values),
    },
    {
      name: 'timestamp.offset',
      description: 'Get the offset of a date based on an expression',
      args: [dateArg, expressionArg],
      onRender: async (_ctx, args) => calculateDatetime(args.values),
    },
  ],
};

function applyDateOp(d: Date, sign: string, amount: number, unit: string): Date {
  switch (unit) {
    case 'y':
      return sign === '-' ? subYears(d, amount) : addYears(d, amount);
    case 'M':
      return sign === '-' ? subMonths(d, amount) : addMonths(d, amount);
    case 'd':
      return sign === '-' ? subDays(d, amount) : addDays(d, amount);
    case 'h':
      return sign === '-' ? subHours(d, amount) : addHours(d, amount);
    case 'm':
      return sign === '-' ? subMinutes(d, amount) : addMinutes(d, amount);
    case 's':
      return sign === '-' ? subSeconds(d, amount) : addSeconds(d, amount);
    default:
      throw new Error(`Invalid data calculation unit: ${unit}`);
  }
}

function parseOp(op: string): { sign: string; amount: number; unit: string } | null {
  const match = op.match(/^([+-]?)(\d+)([yMdhms])$/);
  if (!match) {
    throw new Error(`Invalid date expression: ${op}`);
  }
  const [, sign, amount, unit] = match;
  if (!unit) return null;
  return { sign: sign ?? '+', amount: Number(amount ?? 0), unit };
}

function parseDateString(date: string): Date {
  if (!date.trim()) {
    return new Date();
  }

  const isoDate = parseISO(date);
  if (isValid(isoDate)) {
    return isoDate;
  }

  const jsDate = /^\d+(\.\d+)?$/.test(date) ? new Date(Number(date)) : new Date(date);
  if (isValid(jsDate)) {
    return jsDate;
  }

  throw new Error(`Invalid date: ${date}`);
}

export function calculateDatetime(args: { date?: string; expression?: string }): string {
  const { date, expression } = args;
  let jsDate = parseDateString(date ?? '');

  if (expression) {
    const ops = String(expression)
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const op of ops) {
      const parsed = parseOp(op);
      if (parsed) {
        jsDate = applyDateOp(jsDate, parsed.sign, parsed.amount, parsed.unit);
      }
    }
  }

  return jsDate.toISOString();
}

export function formatDatetime(args: {
  date?: string;
  format?: string;
  in?: ContextFn<Date>;
}): string {
  const { date, format } = args;
  const d = parseDateString(date ?? '');
  return formatDate(d, String(format || 'yyyy-MM-dd HH:mm:ss'), { in: args.in });
}
