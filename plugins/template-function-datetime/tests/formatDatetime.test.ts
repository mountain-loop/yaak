import { describe, expect, it } from 'vitest';
import { formatDatetime, calculateDatetime } from '../src/index';

describe('formatDatetime', () => {
  it('returns formatted current date', async () => {
    const result = await formatDatetime({});
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('returns formatted specific date', async () => {
    const result = await formatDatetime({ date: '2025-07-13T12:34:56' });
    expect(result).toBe('2025-07-13 12:34:56');
  });

  it('returns formatted date with custom output', async () => {
    const result = await formatDatetime({ date: '2025-07-13T12:34:56', output: 'dd/MM/yyyy' });
    expect(result).toBe('13/07/2025');
  });

  it('handles invalid date gracefully', async () => {
    await expect(formatDatetime({ date: 'invalid-date' })).rejects.toThrow('Invalid time value');
  });
});

describe('calculateDatetime', () => {
  it('returns ISO string for current date', async () => {
    const result = await calculateDatetime({});
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns ISO string for specific date', async () => {
    const result = await calculateDatetime({ date: '2025-07-13T12:34:56' });
    expect(result).toBe('2025-07-13T12:34:56.000Z');
  });

  it('applies calc operations', async () => {
    const result = await calculateDatetime({ date: '2025-07-13T12:00:00', calc: '+1d,+2h' });
    expect(result).toBe('2025-07-14T14:00:00.000Z');
  });

  it('applies negative calc operations', async () => {
    const result = await calculateDatetime({ date: '2025-07-13T12:00:00', calc: '-1d,-2h' });
    expect(result).toBe('2025-07-12T10:00:00.000Z');
  });

  it('throws error for invalid unit', async () => {
    await expect(calculateDatetime({ date: '2025-07-13T12:00:00', calc: '+1x' })).rejects.toThrow('Invalid unit: x');
  });
});
