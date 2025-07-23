import { describe, expect, it } from 'vitest';
import { calculateDatetime, formatDatetime } from '../src';

describe('formatDatetime', () => {
  it('returns formatted current date', () => {
    const result = formatDatetime({});
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('returns formatted specific date', () => {
    const result = formatDatetime({ date: '2025-07-13T12:34:56' });
    expect(result).toBe('2025-07-13 12:34:56');
  });

  it('returns formatted specific timestamp', () => {
    const result = formatDatetime({ date: '1752435296000' });
    expect(result).toBe('2025-07-13 12:34:56');
  });

  it('returns formatted specific timestamp with decimals', () => {
    const result = formatDatetime({ date: '1752435296000.19' });
    expect(result).toBe('2025-07-13 12:34:56');
  });

  it('returns formatted date with custom output', () => {
    const result = formatDatetime({ date: '2025-07-13T12:34:56', format: 'dd/MM/yyyy' });
    expect(result).toBe('13/07/2025');
  });

  it('handles invalid date gracefully', () => {
    expect(() => formatDatetime({ date: 'invalid-date' })).toThrow('Invalid date: invalid-date');
  });
});

describe('calculateDatetime', () => {
  it('returns ISO string for current date', () => {
    const result = calculateDatetime({});
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns ISO string for specific date', () => {
    const result = calculateDatetime({ date: '2025-07-13T12:34:56Z' });
    expect(result).toBe('2025-07-13T12:34:56.000Z');
  });

  it('applies calc operations', () => {
    const result = calculateDatetime({ date: '2025-07-13T12:00:00Z', expression: '+1d 2h' });
    expect(result).toBe('2025-07-14T14:00:00.000Z');
  });

  it('applies negative calc operations', () => {
    const result = calculateDatetime({ date: '2025-07-13T12:00:00Z', expression: '-1d -2h 1m' });
    expect(result).toBe('2025-07-12T10:01:00.000Z');
  });

  it('throws error for invalid unit', () => {
    expect(() => calculateDatetime({ date: '2025-07-13T12:00:00Z', expression: '+1x' })).toThrow(
      'Invalid date expression: +1x',
    );
  });
  it('throws error for invalid unit weird', () => {
    expect(() => calculateDatetime({ date: '2025-07-13T12:00:00Z', expression: '+1&#^%' })).toThrow(
      'Invalid date expression: +1&#^%',
    );
  });
  it('throws error for bad expression', () => {
    expect(() =>
      calculateDatetime({ date: '2025-07-13T12:00:00Z', expression: 'bad expr' }),
    ).toThrow('Invalid date expression: bad');
  });
});
