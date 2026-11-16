import { describe, expect, it } from 'vitest';
import { addLaptop, editLaptop } from '../../src/laptops.ts';
import { emptyState } from '../../src/types.ts';
import { makeCtx, validLaptop } from '../helpers.ts';

describe('warehouse, reserved and defective attributes', () => {
  it('stores them on creation', () => {
    const r = addLaptop(emptyState(), { ...validLaptop, warehouse: ' North ', reserved: true, defective: false }, makeCtx());
    expect(r.ok && r.value.laptop).toMatchObject({ warehouse: 'North', reserved: true, defective: false });
  });

  it('leaves them out when not provided', () => {
    const r = addLaptop(emptyState(), validLaptop, makeCtx());
    expect(r.ok && Object.keys(r.value.laptop)).not.toContain('warehouse');
  });

  it.each([{ warehouse: 5 }, { warehouse: 'x'.repeat(101) }, { reserved: 'yes' }, { defective: 1 }])(
    'rejects invalid %j',
    (extra) => {
      expect(addLaptop(emptyState(), { ...validLaptop, ...extra }, makeCtx()).ok).toBe(false);
    },
  );

  it('edits them and records the change', () => {
    const created = addLaptop(emptyState(), validLaptop, makeCtx());
    if (!created.ok) throw new Error('setup');
    const id = created.value.laptop.id;
    const r = editLaptop(created.value.state, id, { warehouse: 'South', defective: true }, makeCtx('2026-01-16T10:00:00.000Z'));
    expect(r.ok && r.value.laptop).toMatchObject({ warehouse: 'South', defective: true });
    expect(r.ok && r.value.laptop.history.at(-1)!.detail).toBe('changed warehouse, defective');
    if (!r.ok) return;
    const cleared = editLaptop(r.value.state, id, { warehouse: '' }, makeCtx('2026-01-17T10:00:00.000Z'));
    expect(cleared.ok && cleared.value.laptop.warehouse).toBeUndefined();
  });
});
