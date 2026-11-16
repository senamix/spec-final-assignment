import { describe, expect, it } from 'vitest';
import { addLaptop } from '../../src/laptops.ts';
import { evaluateLowInventory, getLowLevel, setLowLevel } from '../../src/alerts.ts';
import { emptyState, type State } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

const withLaptops = (n: number): State => {
  let s = emptyState();
  for (let i = 0; i < n; i++) {
    const r = addLaptop(s, { ...validLaptop, serialNumber: `SN-${i}` }, { ...makeCtx(), newId: () => `l${i}` });
    if (r.ok) s = r.value.state;
  }
  return evaluateLowInventory(s, { now: '2026-01-15T10:00:00.000Z', newId: () => 'seed' }).state;
};

describe('getLowLevel', () => {
  it('defaults to 5 with no updater', () => {
    expect(getLowLevel(emptyState())).toEqual({ lowLevel: 5, updatedBy: null, updatedAt: null });
  });
});

describe('setLowLevel validation', () => {
  it.each([-1, 1.5, 100001, Number.NaN, Infinity, '7', null, undefined])('rejects %j on field level with the range in the message', (value) => {
    const r = setLowLevel(emptyState(), value, makeCtx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ code: 'ValidationError', field: 'level' });
      expect(r.error.message).toContain('0 to 100000');
    }
  });

  it.each([0, 5, 100000])('accepts %i', (value) => {
    expect(setLowLevel(emptyState(), value, makeCtx()).ok).toBe(true);
  });
});

describe('setLowLevel behaviour', () => {
  it('records who changed it and when', () => {
    const r = setLowLevel(emptyState(), 8, makeCtx('2026-02-01T00:00:00.000Z', { id: 'acc-9', name: 'Zed' }));
    expect(r.ok && getLowLevel(r.value.state)).toEqual({ lowLevel: 8, updatedBy: 'acc-9', updatedAt: '2026-02-01T00:00:00.000Z' });
  });

  it('raises an alert immediately when the new level is at or above the available count', () => {
    const before = withLaptops(8);
    expect(before.lowPeriodActive).toBe(false);
    const r = setLowLevel(before, 10, { ...makeCtx(), newId: () => 'raised' });
    expect(r.ok && r.value.alert).toMatchObject({ id: 'raised', availableCount: 8, level: 10 });
    expect(r.ok && r.value.state.lowPeriodActive).toBe(true);
  });

  it('clears the low period when the level drops below the available count', () => {
    const low = evaluateLowInventory(withLaptops(3), { now: '2026-01-15T10:00:00.000Z', newId: () => 'a1' }).state;
    expect(low.lowPeriodActive).toBe(true);
    const r = setLowLevel(low, 1, makeCtx());
    expect(r.ok && r.value.alert).toBeNull();
    expect(r.ok && r.value.state.lowPeriodActive).toBe(false);
  });

  it('does not raise a second alert within the same low period', () => {
    const low = evaluateLowInventory(withLaptops(3), { now: '2026-01-15T10:00:00.000Z', newId: () => 'a1' }).state;
    const r = setLowLevel(low, 10, makeCtx());
    expect(r.ok && r.value.alert).toBeNull();
  });

  it('does not mutate its input', () => {
    const s = withLaptops(8);
    const copy = JSON.stringify(s);
    setLowLevel(s, 10, makeCtx());
    expect(JSON.stringify(s)).toBe(copy);
  });
});
