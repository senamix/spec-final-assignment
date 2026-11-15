import { describe, expect, it } from 'vitest';
import { addLaptop, getLaptop } from '../../src/laptops.ts';
import { listLaptops } from '../../src/query.ts';
import { emptyState, type State } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

const add = (state: State, overrides: Record<string, unknown> = {}, ctx = makeCtx()) =>
  addLaptop(state, { ...validLaptop, ...overrides }, ctx);

describe('addLaptop', () => {
  it('adds a laptop that starts Available with a generated id', () => {
    const r = add(emptyState());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.laptop).toMatchObject({ id: 'id-1', brand: 'Dell', status: 'Available', assignments: [] });
    expect(r.value.state.laptops['id-1']).toEqual(r.value.laptop);
  });

  it('records a Created change naming the acting manager and time', () => {
    const r = add(emptyState(), {}, makeCtx('2026-01-15T10:00:00.000Z', { id: 'acc-9', name: 'Bob' }));
    if (!r.ok) throw new Error('setup failed');
    expect(r.value.laptop.history).toEqual([
      expect.objectContaining({ action: 'Created', byAccountId: 'acc-9', byName: 'Bob', at: '2026-01-15T10:00:00.000Z' }),
    ]);
  });

  it('does not modify the input state', () => {
    const state = emptyState();
    add(state);
    expect(state).toEqual(emptyState());
  });

  it('rejects a duplicate serial number ignoring case and spaces', () => {
    const first = add(emptyState());
    if (!first.ok) throw new Error('setup failed');
    const dup = add(first.value.state, { serialNumber: '  sn-1001 ' }, makeCtx());
    expect(dup.ok).toBe(false);
    expect(!dup.ok && dup.error.code).toBe('DuplicateSerialNumber');
    expect(!dup.ok && dup.error.message).toContain('already in use');
  });

  it('names the missing detail', () => {
    const r = add(emptyState(), { model: '' });
    expect(!r.ok && r.error).toMatchObject({ code: 'ValidationError', field: 'model' });
  });

  it('rejects a future purchase date', () => {
    const r = add(emptyState(), { purchaseDate: '2027-01-01' });
    expect(!r.ok && r.error.field).toBe('purchaseDate');
  });
});

describe('getLaptop', () => {
  it('returns the laptop with no current holder', () => {
    const added = add(emptyState());
    if (!added.ok) throw new Error('setup failed');
    const r = getLaptop(added.value.state, 'id-1');
    expect(r.ok && r.value).toMatchObject({ id: 'id-1', currentHolder: null });
  });

  it('returns NotFound for an unknown id', () => {
    const r = getLaptop(emptyState(), 'nope');
    expect(!r.ok && r.error.code).toBe('NotFound');
  });
});

describe('listLaptops (unfiltered)', () => {
  it('returns an empty list for an empty inventory', () => {
    expect(listLaptops(emptyState())).toEqual([]);
  });

  it('lists every laptop sorted by brand, model, then serial number', () => {
    let state = emptyState();
    const ctx = makeCtx();
    for (const [brand, model, serialNumber] of [
      ['Lenovo', 'T14', 'S3'],
      ['Dell', 'XPS', 'S2'],
      ['Dell', 'Latitude', 'S9'],
      ['Dell', 'Latitude', 'S1'],
    ] as const) {
      const r = addLaptop(state, { ...validLaptop, brand, model, serialNumber }, ctx);
      if (!r.ok) throw new Error('setup failed');
      state = r.value.state;
    }
    expect(listLaptops(state).map((l) => l.serialNumber)).toEqual(['S1', 'S9', 'S2', 'S3']);
  });
});
