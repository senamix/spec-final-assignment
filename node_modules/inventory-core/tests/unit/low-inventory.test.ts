import { describe, expect, it } from 'vitest';
import { assignLaptop } from '../../src/assignments.ts';
import { addLaptop, changeStatus, deleteLaptop } from '../../src/laptops.ts';
import { lowInventoryAlert, setLowInventoryThreshold } from '../../src/settings.ts';
import { emptyState, type State } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

function withLaptops(n: number): { state: State; ids: string[] } {
  const ctx = makeCtx();
  let state = emptyState();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = addLaptop(state, { ...validLaptop, serialNumber: `SN-${i}` }, ctx);
    if (!r.ok) throw new Error('seed failed');
    state = r.value.state;
    ids.push(r.value.laptop.id);
  }
  return { state, ids };
}

const threshold = (state: State, value: unknown) => setLowInventoryThreshold(state, value);

describe('threshold setting', () => {
  it('defaults to 3', () => {
    expect(emptyState().settings.lowInventoryThreshold).toBe(3);
  });

  it.each([0, 1, 3, 10_000])('accepts %i', (value) => {
    const r = threshold(emptyState(), value);
    expect(r.ok && r.value.threshold).toBe(value);
    expect(r.ok && r.value.state.settings.lowInventoryThreshold).toBe(value);
  });

  it.each([-1, 10_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, {}])(
    'rejects %s and names the field',
    (value) => {
      const r = threshold(emptyState(), value);
      expect(!r.ok && r.error).toMatchObject({ code: 'ValidationError', field: 'lowInventoryThreshold' });
    },
  );

  it('does not modify the input state', () => {
    const state = emptyState();
    threshold(state, 7);
    expect(state.settings.lowInventoryThreshold).toBe(3);
  });
});

describe('lowInventoryAlert', () => {
  it('is not low while there are more Available laptops than the threshold', () => {
    const { state } = withLaptops(4);
    expect(lowInventoryAlert(state)).toEqual({ low: false, available: 4, threshold: 3, total: 4 });
  });

  it('is low when the Available count equals the threshold', () => {
    const { state } = withLaptops(3);
    expect(lowInventoryAlert(state)).toEqual({ low: true, available: 3, threshold: 3, total: 3 });
  });

  it('is never low for an empty inventory, even with threshold 0', () => {
    expect(lowInventoryAlert(emptyState()).low).toBe(false);
    const zero = threshold(emptyState(), 0);
    if (!zero.ok) throw new Error('setup failed');
    expect(lowInventoryAlert(zero.value.state).low).toBe(false);
  });

  it('with threshold 0, is low only when nothing is Available and the inventory is not empty', () => {
    const { state, ids } = withLaptops(1);
    const zero = threshold(state, 0);
    if (!zero.ok) throw new Error('setup failed');
    expect(lowInventoryAlert(zero.value.state).low).toBe(false);
    const assigned = assignLaptop(zero.value.state, ids[0]!, 'Ada', makeCtx());
    if (!assigned.ok) throw new Error('setup failed');
    expect(lowInventoryAlert(assigned.value.state)).toMatchObject({ low: true, available: 0, total: 1 });
  });

  it('counts only Available laptops (assigned, in repair and retired do not count)', () => {
    const { state, ids } = withLaptops(6);
    const ctx = makeCtx();
    let s = state;
    const a = assignLaptop(s, ids[0]!, 'Ada', ctx);
    if (!a.ok) throw new Error('setup failed');
    s = a.value.state;
    const r = changeStatus(s, ids[1]!, 'InRepair', ctx);
    if (!r.ok) throw new Error('setup failed');
    s = r.value.state;
    const x = changeStatus(s, ids[2]!, 'Retired', ctx);
    if (!x.ok) throw new Error('setup failed');
    expect(lowInventoryAlert(x.value.state)).toEqual({ low: true, available: 3, threshold: 3, total: 6 });
  });

  it('follows additions, deletions and threshold changes', () => {
    const { state, ids } = withLaptops(3);
    expect(lowInventoryAlert(state).low).toBe(true);
    const more = addLaptop(state, { ...validLaptop, serialNumber: 'NEW' }, { ...makeCtx(), newId: () => 'extra-id' });
    if (!more.ok) throw new Error('setup failed');
    expect(lowInventoryAlert(more.value.state).low).toBe(false);
    const del = deleteLaptop(more.value.state, ids[0]!);
    if (!del.ok) throw new Error('setup failed');
    expect(lowInventoryAlert(del.value.state).low).toBe(true);
    const lowered = threshold(del.value.state, 1);
    if (!lowered.ok) throw new Error('setup failed');
    expect(lowInventoryAlert(lowered.value.state)).toMatchObject({ low: false, threshold: 1 });
  });
});
