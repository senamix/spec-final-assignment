import { describe, expect, it } from 'vitest';
import { normalizeSerial, validateLaptopInput, validatePersonName } from '../../src/validation.ts';
import { validLaptop } from '../helpers.ts';

const NOW = '2026-01-15T10:00:00.000Z';
const run = (overrides: Record<string, unknown>) => validateLaptopInput({ ...validLaptop, ...overrides }, NOW);
const failingField = (r: ReturnType<typeof run>) => (r.ok ? undefined : r.error.field);

describe('validateLaptopInput', () => {
  it('accepts a valid laptop and trims text', () => {
    const r = run({ brand: '  Dell  ', serialNumber: ' SN-1 ' });
    expect(r.ok && r.value.brand).toBe('Dell');
    expect(r.ok && r.value.serialNumber).toBe('SN-1');
  });

  it.each(['brand', 'model', 'serialNumber', 'purchaseDate'])('requires %s and names it in the error', (field) => {
    const r = run({ [field]: '   ' });
    expect(r.ok).toBe(false);
    expect(failingField(r)).toBe(field);
    expect(!r.ok && r.error.code).toBe('ValidationError');
  });

  it.each(['brand', 'model', 'serialNumber'])('allows %s of exactly 100 characters and rejects 101', (field) => {
    expect(run({ [field]: 'a'.repeat(100) }).ok).toBe(true);
    expect(failingField(run({ [field]: 'a'.repeat(101) }))).toBe(field);
  });

  it('rejects a purchase date in the future and accepts today', () => {
    expect(failingField(run({ purchaseDate: '2026-01-16' }))).toBe('purchaseDate');
    expect(run({ purchaseDate: '2026-01-15' }).ok).toBe(true);
  });

  it('rejects a malformed or impossible purchase date', () => {
    expect(failingField(run({ purchaseDate: 'yesterday' }))).toBe('purchaseDate');
    expect(failingField(run({ purchaseDate: '2025-02-30' }))).toBe('purchaseDate');
  });

  it.each(['processor', 'memory', 'storage'])('limits spec %s to 100 characters and treats it as optional', (field) => {
    expect(run({ specs: { [field]: 'a'.repeat(100) } }).ok).toBe(true);
    expect(failingField(run({ specs: { [field]: 'a'.repeat(101) } }))).toBe(field);
    expect(run({ specs: {} }).ok).toBe(true);
    expect(run({ specs: undefined }).ok).toBe(true);
  });
});

describe('validatePersonName', () => {
  it('trims and accepts 1 to 100 characters', () => {
    const r = validatePersonName('  Ada  ');
    expect(r.ok && r.value).toBe('Ada');
    expect(validatePersonName('a'.repeat(100)).ok).toBe(true);
  });

  it('rejects empty and over-long names', () => {
    expect(validatePersonName('  ').ok).toBe(false);
    const r = validatePersonName('a'.repeat(101));
    expect(!r.ok && r.error.field).toBe('personName');
  });
});

describe('normalizeSerial', () => {
  it('ignores letter case and surrounding spaces', () => {
    expect(normalizeSerial('  sn-1001 ')).toBe(normalizeSerial('SN-1001'));
  });
});
