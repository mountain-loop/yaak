import type { PluginDefinition } from '@yaakapp/api';

import {
  addDays,
  addMonths,
  addYears,
  addHours,
  addMinutes,
  addSeconds,
  subDays,
  subMonths,
  subYears,
  subHours,
  subMinutes,
  subSeconds,
  format,
  parseISO,
  isValid,
} from 'date-fns';

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
      throw new Error(`Invalid unit: ${unit}`);
  }
}

function parseOp(op: string): { sign: string; amount: number; unit: string } | null {
  const match = op.match(/^([+-])(\d+)([a-zA-Z]+)$/);
  if (!match) return null;
  const [, sign, amount, unit] = match;
  if (!unit) return null;
  if (!['y', 'M', 'd', 'h', 'm', 's'].includes(unit)) {
    throw new Error(`Invalid unit: ${unit}`);
  }
  return { sign: sign ?? '+', amount: Number(amount ?? 0), unit };
}

export async function calculateDatetime(args: {
  date?: string;
  calc?: string;
}): Promise<string> {
  const { date, calc } = args;
  let d: Date;
  if (date) {
    if (/^\d+$/.test(date)) {
      d = new Date(Number(date));
    } else {
      d = parseISO(date);
      if (!isValid(d)) d = new Date(date);
    }
  } else {
    d = new Date();
  }
  if (calc) {
    const ops = String(calc)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const op of ops) {
      const parsed = parseOp(op);
      if (parsed) {
        d = applyDateOp(d, parsed.sign, parsed.amount, parsed.unit);
      }
    }
  }
  return d.toISOString();
}

export async function formatDatetime(args: {
  date?: string;
  output?: string;
}): Promise<string> {
  const { date, output = 'yyyy-MM-dd HH:mm:ss' } = args;
  let d: Date;
  if (date) {
    if (/^\d+$/.test(date)) {
      d = new Date(Number(date));
    } else {
      d = parseISO(date);
      if (!isValid(d)) d = new Date(date);
    }
  } else {
    d = new Date();
  }
  return format(d, String(output));
}

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'datetime.timestamp',
      description: 'Get the current timestamp in milliseconds',
      args: [],
      onRender: async () => String(Date.now()),
    },
    {
      name: 'datetime.iso',
      description: 'Get the current date in ISO format',
      args: [],
      onRender: async () => new Date().toISOString(),
    },
    {
      name: 'datetime.calculate',
      description: 'Manipulate the datetime, returns ISO string. Input is optional, default to current datetime.',
      args: [
        {
          name: 'date',
          label: 'Date String',
          description: 'The date to manipulate, can be a timestamp or ISO string',
          type: 'text',
          optional: true,
          placeholder: 'Default: current date',
        },
        {
          name: 'calc',
          label: 'Calculate Expression',
          description: "The calculate expression in dayjs format, split by commas: '-5d, +2h, 3m'. Available units: y, M, d, h, m, s",
          optional: true,
          placeholder: 'Example: -5d, +2h, 3m',
          type: 'text',
        },
      ],
      onRender: async ({toast}, args) => {
        try {
          return await calculateDatetime(args.values);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          toast.show({
            icon: 'alert_triangle',
            color: 'warning',
            message:`Error calculating date: ${msg}`
          });
          return null;
        }
      },
    },
    {
      name: 'datetime.format',
      description: 'Format a date using a specified format string. Input is optional, default to current datetime.',
      args: [
        {
          name: 'date',
          label: 'Date String',
          description: 'The date to format, can be a timestamp or ISO string',
          type: 'text',
          optional: true,
          placeholder: 'Default: current date',
        },
        {
          name: 'output',
          label: 'Output Format String',
          description: "The output format string in dayjs format, e.g., 'YYYY-MM-DD HH:mm:ss'",
          optional: true,
          placeholder: 'Default: YYYY-MM-DD HH:mm:ss',
          type: 'text',
        },
      ],
      onRender: async ({toast}, args) => {
        try {
          return await formatDatetime(args.values);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          toast.show({
            icon: 'alert_triangle',
            color: 'warning',
            message:`Error formatting date: ${msg}`
          });
          return null;
        }
      },
    },
  ],
};
